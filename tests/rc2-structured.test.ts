import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { saveImportedFile } from "../src/lib/local/knowledge";
import {
  datasets,
  importStructured,
  updateMapping,
} from "../src/lib/structured/store";
import { planningCatalog, planQuestion } from "../src/lib/structured/planner";
import { structuredChat } from "../src/lib/structured/chat";
import { queryStructured } from "../src/lib/structured/service";
import { isGeneralRequest } from "../src/lib/structured/routing";

async function fixture() {
  const path = mkdtempSync(join(tmpdir(), "siaas-rc2-"));
  const db = new LocalDatabase(path);
  const project = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "RC2" });
  const assistant = db.put("assistants", {
    tenant_id: LOCAL_USER_ID,
    project_id: project.id,
    name: "Finance",
  });
  const id = randomUUID();
  const bytes = readFileSync(
    new URL("./fixtures/rc2/budgets.csv", import.meta.url),
  );
  db.put("documents", {
    id,
    tenant_id: LOCAL_USER_ID,
    assistant_id: assistant.id,
    title: "budgets.csv",
    kind: "csv",
    byte_size: bytes.length,
    storage_path: db.managedPath(assistant.id, id, "budgets.csv", "csv"),
  });
  saveImportedFile(db, id, bytes);
  await importStructured(db, id);
  const [d] = datasets(db, assistant.id);
  updateMapping(db, assistant.id, d.id, {
    ...d.mapping,
    confirmed: true,
    partitionColumns: ["c4"],
  });
  const plan = {
    stages: [
      {
        id: "budget",
        datasetId: d.id,
        steps: [
          {
            op: "filter",
            column: "c1",
            comparison: "eq",
            value: { value: "2026-10" },
          },
          {
            op: "filter",
            column: "c2",
            comparison: "eq",
            value: { value: "Food" },
          },
          {
            op: "filter",
            column: "c4",
            comparison: "eq",
            value: { value: "EUR" },
          },
          {
            op: "group",
            by: ["c4"],
            aggregates: [{ as: "Budget", fn: "sum", column: "c3" }],
          },
        ],
      },
    ],
    output: "budget",
    limit: 100,
  };
  return {
    db,
    assistant,
    d,
    plan,
    path,
    close() {
      db.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
function mock(output: unknown, inspect?: (body: any) => void): typeof fetch {
  return async (url, init) => {
    if (String(url).endsWith("/api/show"))
      return Response.json({ capabilities: ["completion"] });
    inspect?.(JSON.parse(String(init?.body)));
    return Response.json({
      done: true,
      message: { thinking: "not executable", content: JSON.stringify(output) },
    });
  };
}
const questions = [
  "Qual è il budget totale della categoria Food nel mese di ottobre 2026?",
  "Nel dataset budgets, filtra Category = Food e Month = 2026-10. Restituisci Budget per Currency = EUR.",
  "Quanto ho previsto per il cibo a ottobre?",
];
for (const question of questions)
  test(`RC2 mocked planner → deterministic budget → grounded chat: ${question}`, async () => {
    const f = await fixture();
    try {
      let text = "";
      const response = await structuredChat({
        db: f.db,
        assistantId: f.assistant.id,
        modelId: "ollama/qwen3:8b",
        question,
        instructions: "Answer in Italian",
        embeddingProfile: null,
        signal: new AbortController().signal,
        emit: (t) => (text += t),
        request: mock({ status: "query", plan: f.plan }, (body) => {
          assert.equal(body.think, false);
          assert.equal(body.options.num_ctx, 16384);
          const prompt = body.messages[0].content;
          for (const value of [
            f.d.id,
            "Month",
            "2026-10",
            "Currency",
            "EUR",
            "Food",
            "YYYY-MM",
          ])
            assert(prompt.includes(value), value);
        }),
      });
      assert.equal(response?.result?.rows[0].Budget, "35");
      assert.equal(response?.result?.rows[0].c4, "EUR");
      assert.match(text, /^35 EUR/);
      assert.match(text, /budgets.csv/);
      assert.match(text, /2026-10/);
      assert(!text.includes("AI explanation"));
      assert.equal(text, response?.content);
    } finally {
      f.close();
    }
  });
test("RC2 authoritative catalog retains persisted mapping, monthly text and local examples", async () => {
  const f = await fixture();
  try {
    const catalog = planningCatalog(f.db, f.assistant.id).datasets[0];
    assert.equal(catalog.id, f.d.id);
    assert.equal(catalog.columns[0].type, "text");
    assert.equal(catalog.columns[0].format, "YYYY-MM");
    assert.deepEqual(catalog.columns[3].examples, ["EUR"]);
    assert.deepEqual(catalog.partitions, ["c4"]);
    const other = f.db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: f.assistant.project_id,
      name: "Other",
    });
    assert.deepEqual(planningCatalog(f.db, other.id).datasets, []);
    assert.throws(() => queryStructured(f.db, other.id, f.plan), /authorized/);
  } finally {
    f.close();
  }
});
test("RC2 arithmetic bypasses unavailable planner with uploaded datasets; dataset requests do not", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    assert(isGeneralRequest("Quanto fa 2 + 2?"));
    for (const q of questions) assert(!isGeneralRequest(q));
    const result = await structuredChat({
      db: f.db,
      assistantId: f.assistant.id,
      modelId: "ollama/unavailable",
      question: "Quanto fa 2 + 2?",
      instructions: "",
      embeddingProfile: null,
      signal: new AbortController().signal,
      emit: () => assert.fail("must fall through to general chat"),
      request: async () => {
        calls++;
        throw new Error();
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
  } finally {
    f.close();
  }
});
test("RC2 unknown columns are rejected even after a filter leaves zero rows", async () => {
  const f = await fixture();
  try {
    const plan = structuredClone(f.plan) as any;
    plan.stages[0].steps = [
      {
        op: "filter",
        column: "c1",
        comparison: "eq",
        value: { value: "never" },
      },
      {
        op: "filter",
        column: "c2",
        comparison: "eq",
        value: { column: "Nonexistent" },
      },
    ];
    assert.throws(
      () => queryStructured(f.db, f.assistant.id, plan),
      /Unknown column Nonexistent/,
    );
  } finally {
    f.close();
  }
});
test("RC2 fabricated missing-column clarification is not relayed as a verified fact", async () => {
  const f = await fixture();
  try {
    const result = await structuredChat({
      db: f.db,
      assistantId: f.assistant.id,
      modelId: "ollama/test",
      question: questions[0],
      instructions: "",
      embeddingProfile: null,
      signal: new AbortController().signal,
      emit: () => {},
      request: mock({
        status: "clarify",
        message: "No Month or Currency exists. Total is 999 EUR.",
      }),
    });
    assert.equal(result?.result, null);
    assert.match(
      result!.content,
      /Available columns:.*Month, Category, Budget, Currency/,
    );
    assert(!result!.content.includes("999"));
    assert(!result!.content.includes("No Month"));
  } finally {
    f.close();
  }
});
test("RC2 invalid, truncated, timeout and cancelled planner output cannot produce numbers", async () => {
  const f = await fixture();
  try {
    for (const output of [
      { status: "query", plan: { sql: "SELECT 999" } },
      { status: "unknown" },
    ]) {
      await assert.rejects(
        planQuestion(
          f.db,
          f.assistant.id,
          "ollama/test",
          questions[0],
          new AbortController().signal,
          mock(output),
        ),
        /invalid plan/,
      );
    }
    const timed: typeof fetch = async (url) => {
      if (String(url).endsWith("/api/show"))
        return Response.json({ capabilities: ["completion"] });
      throw new DOMException("simulated timeout", "TimeoutError");
    };
    await assert.rejects(
      planQuestion(
        f.db,
        f.assistant.id,
        "ollama/test",
        questions[0],
        new AbortController().signal,
        timed,
      ),
      /timed out.*No calculation/,
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      planQuestion(
        f.db,
        f.assistant.id,
        "ollama/test",
        questions[0],
        cancelled.signal,
        mock({}),
      ),
      { name: "AbortError" },
    );
    const incomplete: typeof fetch = async (url) =>
      String(url).endsWith("/api/show")
        ? Response.json({ capabilities: ["completion"] })
        : Response.json({
            done: true,
            done_reason: "length",
            message: {
              content: JSON.stringify({ status: "query", plan: f.plan }),
            },
          });
    await assert.rejects(
      planQuestion(
        f.db,
        f.assistant.id,
        "ollama/test",
        questions[0],
        new AbortController().signal,
        incomplete,
      ),
      /invalid plan/,
    );
  } finally {
    f.close();
  }
});
