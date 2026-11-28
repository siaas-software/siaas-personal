import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionError } from "../../actions";
import { LOCAL_USER_ID } from "../../runtime";
import type { LocalDatabase } from "../database";
import { runNativeOperation, type ToolTrace } from "../native-permissions";
import { videoInputs, mediaRequest } from "./plan";
import { processFrames } from "./processing";

export const mediaSettings = z
  .object({ enabled: z.boolean(), threads: z.number().int().min(1).max(4) })
  .strict();
export function settings(db: LocalDatabase) {
  const w = db.get("workspaces", LOCAL_USER_ID);
  return {
    ...mediaSettings.parse(w?.media_settings ?? { enabled: false, threads: 1 }),
    revision: Number(w?.media_revision ?? 0),
  };
}
export function setSettings(db: LocalDatabase, input: unknown) {
  const value = mediaSettings.parse(input);
  db.transaction(() => {
    const w = db.get("workspaces", LOCAL_USER_ID);
    if (!w) throw new ActionError(404, "Workspace unavailable.");
    db.put(
      "workspaces",
      {
        ...w,
        media_settings: value,
        media_revision: settings(db).revision + 1,
      },
      true,
    );
  });
}
export function owner(db: LocalDatabase, id: string) {
  const a = db.get("assistants", id);
  if (
    a?.tenant_id !== LOCAL_USER_ID ||
    db.get("projects", a.project_id)?.tenant_id !== LOCAL_USER_ID
  )
    throw new ActionError(404, "Assistant unavailable.");
  return a.project_id as string;
}
export function saveMedia(
  db: LocalDatabase,
  p: string,
  a: string,
  mime: string,
  data: Buffer,
  check?: () => void,
) {
  const id = randomUUID(),
    digest = createHash("sha256").update(data).digest("hex");
  db.transaction(() => {
    check?.();
    if (owner(db, a) !== p)
      throw new ActionError(404, "Assistant unavailable.");
    const usage = db.sql
      .prepare(
        "SELECT count(*) AS n, coalesce(sum(length(bytes)),0) AS used FROM media_files",
      )
      .get()!;
    if (
      Number(usage.n) >= 512 ||
      Number(usage.used) + data.length > 64 * 1024 * 1024
    )
      throw new ActionError(409, "Media storage quota reached.");
    db.sql
      .prepare(
        "INSERT INTO media_files(id,project_id,assistant_id,mime,digest,bytes) VALUES(?,?,?,?,?,?)",
      )
      .run(id, p, a, mime, digest, data);
  });
  return id;
}
export async function executeMedia(
  db: LocalDatabase,
  a: string,
  trace: ToolTrace,
  raw: unknown,
  signal: AbortSignal,
) {
  const job = mediaRequest.parse(raw),
    config = settings(db);
  const p = owner(db, a);
  if (p !== trace.projectId || !config.enabled)
    throw new ActionError(403, "Media processing unavailable.");
  const lookup = db.sql.prepare(
    "SELECT digest FROM media_files WHERE id=? AND project_id=? AND assistant_id=? AND mime=?",
  );
  const mime =
    job.kind === "inspect"
      ? db.sql
          .prepare(
            "SELECT mime FROM media_files WHERE id=? AND project_id=? AND assistant_id=?",
          )
          .get(job.inputs[0], p, a)?.mime
      : videoInputs(job.kind)
        ? "video/mp4"
        : "image/png";
  if (mime !== "image/png" && mime !== "video/mp4")
    throw new ActionError(404, "Media input unavailable.");
  const digests = job.inputs.map((id) => lookup.get(id, p, a, mime)?.digest);
  if (digests.some((d) => typeof d !== "string"))
    throw new ActionError(404, "Media input unavailable.");
  const accessible = () =>
    settings(db).enabled &&
    settings(db).revision === config.revision &&
    job.inputs.every(
      (id, i) => lookup.get(id, p, a, mime)?.digest === digests[i],
    );
  return runNativeOperation(
    db,
    a,
    trace,
    signal,
    "media_process",
    { ...job, digests, configuration: config.revision },
    async (revalidate) => {
      revalidate();
      const bytes = db.sql.prepare(
        "SELECT bytes FROM media_files WHERE id=? AND project_id=? AND assistant_id=?",
      );
      const result = await processFrames(
        db.directory,
        job,
        mime === "video/mp4",
        job.inputs.map((id) =>
          Buffer.from(bytes.get(id, p, a)!.bytes as Uint8Array),
        ),
        config.threads,
        signal,
        revalidate,
      );
      if (result.type === "metadata") return JSON.stringify(result.metadata);
      const id = saveMedia(db, p, a, result.mime, result.bytes, revalidate);
      return `[Download / Scarica](/api/assistants/${a}/media?file=${id})`;
    },
    undefined,
    accessible,
  );
}
