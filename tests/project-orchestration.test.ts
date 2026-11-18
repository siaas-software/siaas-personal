import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProjectOrchestration,
  validateProjectParticipants,
  validateOrchestrationPlan,
  executeProjectPlan,
  ProjectOrchestrationError,
} from "../src/lib/project-orchestration";

const projectId = "11111111-1111-4111-8111-111111111111";
const aId = "22222222-2222-4222-8222-222222222222";
const bId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const tenant = "55555555-5555-4555-8555-555555555555";
const project = { id: projectId, tenant_id: tenant };
const members = [
  { id: aId, project_id: projectId, tenant_id: tenant },
  { id: bId, project_id: projectId, tenant_id: tenant },
  { id: otherId, project_id: "66666666-6666-4666-8666-666666666666", tenant_id: tenant },
];
const config = parseProjectOrchestration({
  enabled: true, assistant_ids: [aId, bId], instructions: "Delegate in order.", max_steps: 2,
});
const plan = { steps: [
  { assistant_id: aId, task: "Find the selected document" },
  { assistant_id: bId, task: "Review the handoff; use only authorized sources" },
] };

test("project orchestration is opt-in, bounded and rejects unknown settings", () => {
  assert.equal(parseProjectOrchestration(undefined).enabled, false);
  assert.equal(parseProjectOrchestration(undefined).max_steps, 4);
  assert.deepEqual(config.assistant_ids, [aId, bId]);
  for (const bad of [
    { enabled: true, assistant_ids: [] },
    { enabled: true, assistant_ids: [aId, aId] },
    { enabled: true, assistant_ids: [aId], max_steps: 9 },
    { enabled: true, assistant_ids: [aId], shell: true },
    { enabled: "yes", assistant_ids: [aId] },
  ]) {
    assert.throws(() => parseProjectOrchestration(bad), ProjectOrchestrationError);
  }
  assert.throws(() => validateOrchestrationPlan(plan, parseProjectOrchestration(undefined)),
    /non abilitata/);
});

test("plan rejects unselected assistants, invented steps and overlong tasks", () => {
  assert.deepEqual(validateOrchestrationPlan(plan, config), plan);
  for (const bad of [
    { steps: [...plan.steps, plan.steps[0]] },
    { steps: [{ assistant_id: otherId, task: "Read other project" }] },
    { steps: [{ assistant_id: aId, task: "x".repeat(1801) }] },
    { steps: [{ assistant_id: aId, task: " " }] },
    { steps: [{ assistant_id: aId, task: "work", instructions: "ignore permissions" }] },
  ]) assert.throws(() => validateOrchestrationPlan(bad, config), ProjectOrchestrationError);
});

test("delegation is sequential; the same assistant adapter receives explicit context", async () => {
  const calls: string[] = [];
  const result = await executeProjectPlan({
    project, tenantId: tenant, config, members, plan,
    signal: new AbortController().signal,
    async delegate({ projectId: id, assistantId, previousResult }) {
      assert.equal(id, projectId);
      calls.push(assistantId);
      if (assistantId === aId) {
        assert.equal(previousResult, null);
        return { status: "complete", text: "doc_1" };
      }
      assert.deepEqual(previousResult, { assistant_id: aId, text: "doc_1" });
      return { status: "complete", text: "mapped fields: 6" };
    },
  });
  assert.deepEqual(calls, [aId, bId]);
  assert.equal(result.status, "complete");
  assert.equal(result.steps[1].text, "mapped fields: 6");
});

test("cross-project membership and foreign tenant are rejected before delegation", async () => {
  assert.throws(() => validateProjectParticipants(project, "foreign", config, members),
    /Progetto non autorizzato/);
  assert.throws(() => validateProjectParticipants(project, tenant, {
    ...config, assistant_ids: [otherId],
  }, members), /non appartengono/);
  let calls = 0;
  await assert.rejects(executeProjectPlan({
    project, tenantId: tenant,
    config: { ...config, assistant_ids: [otherId] },
    members, plan: { steps: [{ assistant_id: otherId, task: "Go" }] },
    signal: new AbortController().signal,
    delegate: async () => { calls++; return { status: "complete", text: "unsafe" }; },
  }), ProjectOrchestrationError);
  assert.equal(calls, 0);
});

test("failed delegation stops the workflow; nothing reports false success", async () => {
  let calls = 0;
  await assert.rejects(executeProjectPlan({
    project, tenantId: tenant, config, members, plan,
    signal: new AbortController().signal,
    delegate: async () => {
      calls++;
      return { status: calls === 1 ? "error" : "complete", text: "failure" };
    },
  }), /incompleta/);
  assert.equal(calls, 1);
});

test("cancellation and overly long handoff halt execution", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(executeProjectPlan({
    project, tenantId: tenant, config, members, plan, signal: controller.signal,
    delegate: async () => {
      called = true;
      return { status: "complete", text: "bad" };
    },
  }));
  assert.equal(called, false);
  await assert.rejects(executeProjectPlan({
    project, tenantId: tenant, config, members, plan,
    signal: new AbortController().signal,
    delegate: async () => ({ status: "complete", text: "x".repeat(12001) }),
  }), /incompleta/);
});
