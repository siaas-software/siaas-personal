import { after } from "next/server";
import { z } from "zod";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import type { Assistant, Project } from "@/lib/catalog";
import { getAction } from "@/lib/local/actions";
import { ExecutionEventStore } from "@/lib/local/execution-events";
import { executeAssistantTask } from "@/lib/local/assistant-execution";
import {
  executeProjectPlan,
  parseProjectOrchestration,
  validateProjectParticipants,
  ProjectOrchestrationError,
} from "@/lib/project-orchestration";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
type Database = Awaited<ReturnType<typeof localWorkspace>>["db"];

function projectOrThrow(db: Database, id: string, tenantId: string) {
  const project = db.get("projects", id) as Project | null;
  if (!project || project.tenant_id !== tenantId)
    throw new HttpError(404, "Progetto non trovato.");
  return project;
}

function recoverRuns(db: Database, projectId: string) {
  for (const run of db
    .rows("project_runs")
    .filter(
      (row) => row.project_id === projectId && row.status === "running",
    )) {
    if (
      !run.lease_until ||
      !Number.isFinite(Date.parse(run.lease_until)) ||
      Date.parse(run.lease_until) <= Date.now()
    ) {
      db.put(
        "project_runs",
        {
          ...run,
          status: "error",
          error: "Previous execution expired / Esecuzione precedente scaduta.",
          completed_at: new Date().toISOString(),
          lease_until: null,
        },
        true,
      );
    }
  }
}

export async function GET(req: Request, { params }: Context) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const projectId = uuid.parse((await params).id);
    projectOrThrow(db, projectId, tenantId);
    recoverRuns(db, projectId);
    const runs = db
      .rows("project_runs")
      .filter(
        (run) => run.tenant_id === tenantId && run.project_id === projectId,
      )
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 50);
    return Response.json(runs, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}

/** Cancellation is persisted, so it also reaches work after the POST has returned. */
export async function DELETE(req: Request, { params }: Context) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const projectId = uuid.parse((await params).id);
    projectOrThrow(db, projectId, tenantId);
    const { run_id } = z
      .object({ run_id: uuid })
      .strict()
      .parse(await jsonBody(req, 1000));
    const run = db.get("project_runs", run_id);
    if (!run || run.project_id !== projectId || run.tenant_id !== tenantId)
      throw new HttpError(404, "Esecuzione non trovata.");
    if (run.status === "running")
      db.put("project_runs", { ...run, cancel_requested: true }, true);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: Request, { params }: Context) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const projectId = uuid.parse((await params).id);
    const project = projectOrThrow(db, projectId, tenantId);
    const { question, language, action_id } = z
      .object({
        question: z.string().trim().min(1).max(1800),
        language: z.enum(["it", "en"]).default("en"),
        action_id: z.string().min(1).max(100).optional(),
      })
      .strict()
      .parse(await jsonBody(req, 8000));
    const action = action_id ? getAction(db, action_id) : undefined;
    const config = parseProjectOrchestration(project.orchestration);
    if (!config.enabled)
      throw new HttpError(
        409,
        "Enable project orchestration / Abilita l'orchestrazione.",
      );
    if (config.assistant_ids.length > config.max_steps)
      throw new HttpError(
        409,
        "Step budget exceeded / Limite dei passaggi superato.",
      );
    const members = db
      .rows("assistants")
      .filter(
        (a) => a.project_id === projectId && a.tenant_id === tenantId,
      ) as Assistant[];
    validateProjectParticipants(project, tenantId, config, members);
    const run = db.transaction(() => {
      recoverRuns(db, projectId);
      if (
        db
          .rows("project_runs")
          .some(
            (row) => row.project_id === projectId && row.status === "running",
          )
      )
        throw new HttpError(
          409,
          "Project execution in progress / Esecuzione in corso.",
        );
      return db.put("project_runs", {
        tenant_id: tenantId,
        project_id: projectId,
        question,
        action_id: action?.id,
        status: "running",
        lease_until: new Date(Date.now() + 300_000).toISOString(),
        steps: [],
        result: null,
      });
    });
    const work = async () => {
      const abort = new AbortController();
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(240_000),
      ]);
      let currentAssistantId: string | undefined;
      const check = () => {
        signal.throwIfAborted();
        const active = db.get("project_runs", run.id);
        if (!active || active.status !== "running" || active.cancel_requested)
          throw new Error("Execution cancelled / Esecuzione annullata.");
        const latest = projectOrThrow(db, projectId, tenantId);
        const latestConfig = parseProjectOrchestration(latest.orchestration);
        if (
          !latestConfig.enabled ||
          config.assistant_ids.some(
            (id) => !latestConfig.assistant_ids.includes(id),
          )
        )
          throw new Error("Delegation revoked / Delega revocata.");
        if (config.share_results && !latestConfig.share_results)
          throw new Error("Result sharing revoked / Condivisione revocata.");
        if (config.assistant_ids.length > latestConfig.max_steps)
          throw new Error(
            "Step budget revoked / Limite dei passaggi modificato.",
          );
        for (const id of config.assistant_ids) {
          const a = db.get("assistants", id);
          if (!a || a.project_id !== projectId || a.tenant_id !== tenantId)
            throw new Error(
              "Assistant membership changed / Appartenenza modificata.",
            );
        }
        return latestConfig;
      };
      const timer = setInterval(() => {
        try {
          check();
        } catch (error) {
          abort.abort(error);
        }
      }, 100);
      try {
        new ExecutionEventStore(db).append({ projectId, sessionId: run.id, traceId: run.id, kind: "session.started" });
        const result = await executeProjectPlan({
          project,
          tenantId,
          config,
          members,
          plan: {
            steps: config.assistant_ids.map((assistant_id) => ({
              assistant_id,
              task: question,
            })),
          },
          signal,
          delegate: async ({ assistantId, task, previousResult }) => {
            const latest = check();
            currentAssistantId = assistantId;
            const assistant = db.get("assistants", assistantId) as Assistant;
            const saved = db.get("project_runs", run.id)!;
            const index = saved.steps.length;
            db.put(
              "project_runs",
              {
                ...saved,
                steps: [
                  ...saved.steps,
                  {
                    assistant_id: assistantId,
                    status: "running",
                    text: "",
                    sources: [],
                    artifacts: [],
                  },
                ],
              },
              true,
            );
            const updateStep = (changes: Record<string, unknown>) => {
              const row = db.get("project_runs", run.id);
              if (!row || row.status !== "running")
                throw new Error("Project run removed or expired.");
              const steps = [...row.steps];
              steps[index] = { ...steps[index], ...changes };
              db.put("project_runs", { ...row, steps }, true);
            };
            let partial = "";
            let savedAt = 0;
            const output = await executeAssistantTask({
              projectRunId: run.id,
              db,
              assistant,
              question: task,
              action,
              language,
              history: [],
              coordinatorInstructions: latest.instructions,
              handoff: previousResult
                ? {
                    assistantId: previousResult.assistant_id,
                    text: previousResult.text,
                  }
                : undefined,
              signal,
              emit(event) {
                check();
                if (event.type === "delta") {
                  partial += String(event.text);
                  if (Date.now() - savedAt > 250) {
                    updateStep({ text: partial.slice(0, 12000) });
                    savedAt = Date.now();
                  }
                }
                if (event.type === "start")
                  updateStep({ execution_path: event.execution_path });
                if (event.type === "steps")
                  updateStep({ agent_steps: event.steps });
                if (event.type === "sources")
                  updateStep({ sources: event.sources });
                if (event.type === "research")
                  updateStep({
                    research_warnings: event.warnings,
                    research_missing: event.missing,
                  });
              },
            });
            check();
            const tooLong =
              output.text.length > 12000 ||
              output.artifacts.some((a) => a.content.length > 32000);
            updateStep({
              text: output.text.slice(0, 12000),
              status: tooLong ? "error" : output.status,
              error: tooLong
                ? "Result exceeds project limits / Risultato oltre i limiti."
                : output.error,
              execution_path: output.executionPath,
              sources: output.sources,
              structured_analysis: output.structuredAnalysis,
              input_tokens: output.inputTokens,
              output_tokens: output.outputTokens,
              model_id: output.executionPath.startsWith("model")
                ? assistant.model_id
                : null,
              artifacts: output.artifacts.filter(
                (a) => a.content.length <= 32000,
              ),
            });
            if (output.status === "error" || tooLong)
              throw new Error(output.error || "Result exceeds project limits.");
            return { status: "complete", text: output.text };
          },
        });
        check();
        const current = db.get("project_runs", run.id)!;
        db.put(
          "project_runs",
          {
            ...current,
            status: "complete",
            result: result.steps.at(-1)?.text,
            lease_until: null,
            completed_at: new Date().toISOString(),
          },
          true,
        );
      } catch (error) {
        const current = db.get("project_runs", run.id);
        if (current?.status === "running") {
          const message =
            abort.signal.reason instanceof Error
              ? abort.signal.reason.message
              : error instanceof Error
                ? error.message.slice(0, 500)
                : "Execution interrupted.";
          db.put(
            "project_runs",
            {
              ...current,
              status: "error",
              error: message,
              lease_until: null,
              steps: current.steps.map(
                (step: { assistant_id: string; status: string }) =>
                  step.assistant_id === currentAssistantId &&
                  step.status === "running"
                    ? { ...step, status: "error", error: message }
                    : step,
              ),
              completed_at: new Date().toISOString(),
            },
            true,
          );
        }
      } finally {
        clearInterval(timer);
      }
    };
    after(work);
    return Response.json(run, {
      status: 202,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ProjectOrchestrationError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    return fail(error);
  }
}
