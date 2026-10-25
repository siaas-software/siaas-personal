import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { parseStructured } from "../src/lib/structured/parser";
import { profile, initialMapping } from "../src/lib/structured/profile";
import { executePlan, planSchema } from "../src/lib/structured/engine";
import {
  datasets,
  importStructured,
  inspectDatasets,
  relations,
  saveRelationship,
  updateMapping,
} from "../src/lib/structured/store";
import { queryStructured } from "../src/lib/structured/service";
import { planQuestion, planningSchema } from "../src/lib/structured/planner";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import {
  connectFolder,
  removeLocalDocument,
  saveImportedFile,
} from "../src/lib/local/knowledge";
import {
  templateBundleSchema,
  BUILTIN_TEMPLATES,
  templateBundle,
} from "../src/lib/templates";
import { importLocalTemplate } from "../src/lib/local/template-project";
import { retrieveAssistantSources } from "../src/lib/local/assistant-research";
import type { Dataset, Relationship, Value } from "../src/lib/structured/types";
function fixture(
  name: string,
  values: Value[][],
  types: Dataset["mapping"]["types"] = {},
  partitions: string[] = [],
): Dataset {
  const sheet = {
    name,
    rows: values.map((row) => row.map((value) => ({ value }))),
    warnings: [],
  };
  return {
    id: randomUUID(),
    assistantId: randomUUID(),
    documentId: randomUUID(),
    filename: name + ".csv",
    worksheet: name,
    revision: "a".repeat(64),
    sheet,
    mapping: {
      ...initialMapping(sheet),
      types,
      confirmed: true,
      partitionColumns: partitions,
    },
  };
}
function plan(d: Dataset, steps: unknown[] = []) {
  return {
    stages: [{ id: "data", datasetId: d.id, steps }],
    output: "data",
    limit: 100,
  };
}
const amounts = () =>
  fixture("Sales", [
    ["Product", "Amount", "Date"],
    ["A", "0.1", "2026-10-01"],
    ["A", "0.2", "2026-10-02"],
    ["B", null, "2026-11-01"],
    ["B", "2", "2026-11-02"],
  ]);
const group = {
  op: "group",
  by: ["c1"],
  aggregates: [
    { as: "total", fn: "sum", column: "c2" },
    { as: "average", fn: "avg", column: "c2" },
    { as: "count", fn: "count" },
    { as: "min", fn: "min", column: "c2" },
    { as: "max", fn: "max", column: "c2" },
  ],
};
test("CSV quoted fields, newlines, empty cells and source rows", async () => {
  const [sheet] = await parseStructured(
    Buffer.from(
      'Code,Description,Amount\r\n001,"line 1\nline 2",1.2\r\n002,"a,b",\r\n',
    ),
    "csv",
  );
  const d = fixture("x", []);
  d.sheet = sheet;
  d.mapping = initialMapping(sheet);
  const p = profile(d);
  assert.equal(p.rows[0].values.c1, "001");
  assert.equal(p.rows[0].sourceRow, 2);
  assert.equal(p.rows[1].values.c3, null);
  assert.equal(p.rows[0].values.c2, "line 1\nline 2");
});
test("XLSX multiple sheets, dates, literal numbers, formulas and missing cache", async () => {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("Orders");
  s.addRow(["Date", "Quantity", "Total"]);
  s.addRow([new Date("2026-10-01"), 2, { formula: "B2*2", result: 4 }]);
  s.addRow([null, 3, { formula: "B3*2" }]);
  wb.addWorksheet("Inventory").addRows([
    ["Code", "Stock"],
    ["A", 4],
  ]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const sheets = await parseStructured(bytes, "xlsx");
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].rows[1][0].value, "2026-10-01");
  assert.equal(sheets[0].rows[1][1].value, 2);
  assert.equal(sheets[0].rows[1][2].formula, "B2*2");
  assert.equal(sheets[0].rows[1][2].cached, 4);
  assert.equal(sheets[0].rows[2][2].cached, null);
});
test("single-sheet XLSX preserves a zero formula cache", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("S").addRows([["A"], [{ formula: "1-1", result: 0 }]]);
  const [s] = await parseStructured(
    Buffer.from(await wb.xlsx.writeBuffer()),
    "xlsx",
  );
  assert.equal(s.rows[1][0].cached, 0);
});
test("empty and corrupt inputs fail gracefully", async () => {
  for (const [bytes, kind] of [
    [Buffer.alloc(0), "csv"],
    [Buffer.from("\n\n"), "csv"],
    [Buffer.from("not a workbook"), "xlsx"],
    [Buffer.from('a,b\n"unclosed,2'), "csv"],
  ] as const)
    await assert.rejects(parseStructured(bytes, kind));
});
test("file and row resource limits are enforced", async () => {
  await assert.rejects(
    parseStructured(Buffer.alloc(10 * 1024 * 1024 + 1), "csv"),
    /10 MB/,
  );
  await assert.rejects(
    parseStructured(Buffer.from("A\n" + "1\n".repeat(50001)), "csv"),
    /50000/,
  );
});
test("large supported CSV imports completely without truncation", async () => {
  const [s] = await parseStructured(
    Buffer.from(
      "Code,Amount\n" +
        Array.from({ length: 10000 }, (_, i) => `P${i},1`).join("\n"),
    ),
    "csv",
  );
  assert.equal(s.rows.length, 10001);
});
test("header detection, no headers and duplicate headers", () => {
  const d = fixture("x", [
    [1, 2],
    [3, 4],
  ]);
  assert.equal(d.mapping.headerRow, 0);
  assert.equal(profile(d).rowCount, 2);
  const dup = fixture("x", [
    ["A", "A"],
    [1, 2],
  ]);
  assert.match(profile(dup).warnings.join(), /Duplicate header/);
  assert.deepEqual(
    profile(dup).columns.map((c) => c.id),
    ["c1", "c2"],
  );
});
test("invalid dates/numbers, duplicates and null statistics are reported", () => {
  const d = fixture(
    "x",
    [
      ["Date", "Number"],
      ["2026-02-30", "oops"],
      ["2026-02-30", "oops"],
      [null, null],
    ],
    { c1: "date", c2: "number" },
  );
  const p = profile(d);
  assert.equal(p.columns[0].invalid, 2);
  assert.equal(p.columns[1].invalid, 2);
  assert.equal(p.columns[0].missing, 1);
  assert.equal(p.duplicates, 2);
  assert.throws(() => executePlan(plan(d), [d], []), /Invalid typed/);
});
test("filter and sort use typed numeric comparison", () => {
  const d = amounts();
  const r = executePlan(
    plan(d, [
      { op: "filter", column: "c2", comparison: "gt", value: { value: 0.1 } },
      { op: "sort", by: [{ column: "c2", direction: "desc" }] },
    ]),
    [d],
    [],
  );
  assert.deepEqual(
    r.rows.map((r) => r.c2),
    ["2", "0.2"],
  );
});
test("all aggregations, exact decimals and missing values", () => {
  const d = amounts();
  const r = executePlan(plan(d, [group]), [d], []);
  assert.deepEqual(r.rows[0], {
    c1: "A",
    total: "0.3",
    average: "0.15",
    count: 2,
    min: "0.1",
    max: "0.2",
  });
  assert.match(r.warnings.join(), /missing values excluded/);
});
test("date grouping by month", () => {
  const d = amounts();
  const r = executePlan(
    plan(d, [
      { op: "derive", as: "month", operator: "month", left: { column: "c3" } },
      {
        op: "group",
        by: ["month"],
        aggregates: [{ as: "total", fn: "sum", column: "c2" }],
      },
    ]),
    [d],
    [],
  );
  assert.deepEqual(r.rows, [
    { month: "2026-10", total: "0.3" },
    { month: "2026-11", total: "2" },
  ]);
});
test("calculated differences, multiply, divide, abs and ceil", () => {
  const d = fixture("x", [
    ["A", "B"],
    [4, 3],
  ]);
  const r = executePlan(
    plan(d, [
      {
        op: "derive",
        as: "difference",
        operator: "subtract",
        left: { column: "c1" },
        right: { column: "c2" },
      },
      {
        op: "derive",
        as: "product",
        operator: "multiply",
        left: { column: "c1" },
        right: { column: "c2" },
      },
      {
        op: "derive",
        as: "ratio",
        operator: "divide",
        left: { column: "product" },
        right: { value: 5 },
      },
      {
        op: "derive",
        as: "pallets",
        operator: "ceil",
        left: { column: "ratio" },
      },
    ]),
    [d],
    [],
  );
  assert.equal(r.rows[0].difference, "1");
  assert.equal(r.rows[0].pallets, "3");
});
test("division by zero and nonnumeric arithmetic fail", () => {
  const d = amounts();
  assert.throws(
    () =>
      executePlan(
        plan(d, [
          {
            op: "derive",
            as: "x",
            operator: "divide",
            left: { column: "c2" },
            right: { value: 0 },
          },
        ]),
        [d],
        [],
      ),
    /zero/,
  );
  assert.throws(
    () =>
      executePlan(
        plan(d, [
          {
            op: "derive",
            as: "x",
            operator: "add",
            left: { column: "c1" },
            right: { value: 1 },
          },
        ]),
        [d],
        [],
      ),
    /number/,
  );
});
test("duplicate record detection returns candidate records", () => {
  const d = amounts();
  assert.equal(
    executePlan(plan(d, [{ op: "duplicates", by: ["c1"] }]), [d], []).totalRows,
    4,
  );
});
test("unsafe operations, arbitrary SQL/code and invalid columns rejected", () => {
  const d = amounts();
  for (const input of [
    { sql: "DROP TABLE documents" },
    plan(d, [{ op: "eval", code: "process.exit()" }]),
    plan(d, [
      {
        op: "filter",
        column: "__proto__",
        comparison: "eq",
        value: { value: 1 },
      },
    ]),
  ])
    assert.throws(() => executePlan(input, [d], []));
});
test("query time/operation limits and result limits", () => {
  const d = amounts();
  assert.throws(
    () => executePlan(plan(d), [d], [], { maxOperations: 1 }),
    /resource/,
  );
  assert.throws(() => executePlan(plan(d), [d], [], { maxMs: -1 }), /resource/);
  assert.throws(() => planSchema.parse({ ...plan(d), limit: 201 }));
  const r = executePlan({ ...plan(d), limit: 1 }, [d], []);
  assert.equal(r.totalRows, 4);
  assert.equal(r.truncated, true);
});
test("unconfirmed mapping and cross-assistant dataset are rejected", () => {
  const d = amounts();
  assert.throws(() => executePlan(plan(d), [], []), /authorized/);
  d.mapping.confirmed = false;
  assert.throws(() => executePlan(plan(d), [d], []), /Confirm/);
});
test("formula caches require explicit acceptance and missing cache never becomes zero", () => {
  const d = fixture("x", [["Value"], [null]], { c1: "number" });
  d.sheet.rows[1][0] = { value: null, formula: "1+2", cached: 3 };
  assert.throws(
    () =>
      executePlan(
        plan(d, [
          {
            op: "group",
            by: [],
            aggregates: [{ as: "total", fn: "sum", column: "c1" }],
          },
        ]),
        [d],
        [],
      ),
    /formula/,
  );
  d.mapping.useCachedFormulas = true;
  assert.equal(executePlan(plan(d), [d], []).rows[0].c1, 3);
  d.sheet.rows[1][0].cached = null;
  assert.throws(() => executePlan(plan(d), [d], []), /formula/);
});
function manufacturing() {
  const orders = fixture("Orders", [
    ["Product", "Quantity"],
    ["A", 10],
    ["A", 5],
    ["B", 4],
    ["UNKNOWN", 1],
  ]);
  const stock = fixture("Stock", [
    ["Product", "Available"],
    ["A", 12],
    ["B", 6],
  ]);
  const rel: Relationship = {
    id: randomUUID(),
    leftDataset: orders.id,
    leftColumn: "c1",
    rightDataset: stock.id,
    rightColumn: "c1",
    cardinality: "many-to-one",
  };
  return { orders, stock, rel };
}
test("production: aggregate sales orders versus stock and preserve missing records", () => {
  const { orders, stock, rel } = manufacturing();
  const p = {
    stages: [
      { id: "stock", datasetId: stock.id, steps: [] },
      {
        id: "orders",
        datasetId: orders.id,
        steps: [
          {
            op: "group",
            by: ["c1"],
            aggregates: [{ as: "ordered", fn: "sum", column: "c2" }],
          },
          { op: "join", right: "stock", relationshipId: rel.id, kind: "left" },
          {
            op: "derive",
            as: "shortage",
            operator: "subtract",
            left: { column: "ordered" },
            right: { column: "stock.c2" },
          },
        ],
      },
    ],
    output: "orders",
  };
  const r = executePlan(p, [orders, stock], [rel]);
  assert.deepEqual(
    r.rows.map((r) => r.shortage),
    ["3", "-2", null],
  );
  assert.match(JSON.stringify(r.evidence), /Orders.csv/);
  assert.match(JSON.stringify(r.evidence), /sourceRange/);
});
test("production: BOM demand and material shortage with partial datasets", () => {
  const orders = fixture("Orders", [
      ["Product", "Quantity"],
      ["A", 10],
    ]),
    bom = fixture("BOM", [
      ["Product", "Material", "Required"],
      ["A", "M", 2],
    ]),
    stock = fixture("Materials", [
      ["Material", "Available"],
      ["M", 15],
    ]);
  const a: Relationship = {
      id: randomUUID(),
      leftDataset: orders.id,
      leftColumn: "c1",
      rightDataset: bom.id,
      rightColumn: "c1",
      cardinality: "many-to-many",
    },
    b: Relationship = {
      id: randomUUID(),
      leftDataset: bom.id,
      leftColumn: "c2",
      rightDataset: stock.id,
      rightColumn: "c1",
      cardinality: "many-to-one",
    };
  const r = executePlan(
    {
      stages: [
        { id: "bom", datasetId: bom.id, steps: [] },
        { id: "stock", datasetId: stock.id, steps: [] },
        {
          id: "needs",
          datasetId: orders.id,
          steps: [
            { op: "join", right: "bom", relationshipId: a.id, kind: "inner" },
            {
              op: "derive",
              as: "required",
              operator: "multiply",
              left: { column: "c2" },
              right: { column: "bom.c3" },
            },
            {
              op: "group",
              by: ["bom.c2"],
              aggregates: [{ as: "need", fn: "sum", column: "required" }],
            },
            { op: "join", right: "stock", relationshipId: b.id, kind: "left" },
            {
              op: "derive",
              as: "shortage",
              operator: "subtract",
              left: { column: "need" },
              right: { column: "stock.c2" },
            },
          ],
        },
      ],
      output: "needs",
    },
    [orders, bom, stock],
    [a, b],
  );
  assert.equal(r.rows[0].shortage, "5");
});
test("missing product identifiers use anti join; unknown relationships fail", () => {
  const { orders, stock, rel } = manufacturing();
  const p = {
    stages: [
      { id: "stock", datasetId: stock.id, steps: [] },
      {
        id: "orders",
        datasetId: orders.id,
        steps: [
          { op: "join", right: "stock", relationshipId: rel.id, kind: "anti" },
        ],
      },
    ],
    output: "orders",
  };
  assert.equal(executePlan(p, [orders, stock], [rel]).rows[0].c1, "UNKNOWN");
  assert.throws(
    () => executePlan(p, [orders, stock], []),
    /confirmed relationship/,
  );
});
test("finance: income/expense totals and monthly spending preserve currencies", () => {
  const d = fixture(
    "Transactions",
    [
      ["Date", "Type", "Amount", "Currency"],
      ["2026-10-01", "income", 1000, "EUR"],
      ["2026-10-02", "expense", 100, "EUR"],
      ["2026-10-03", "expense", 50, "USD"],
    ],
    {},
    ["c4"],
  );
  const r = executePlan(
    plan(d, [
      { op: "derive", as: "month", operator: "month", left: { column: "c1" } },
      {
        op: "group",
        by: ["month", "c2", "c4"],
        aggregates: [{ as: "amount", fn: "sum", column: "c3" }],
      },
    ]),
    [d],
    [],
  );
  assert.equal(r.totalRows, 3);
  assert.throws(
    () =>
      executePlan(
        plan(d, [
          {
            op: "group",
            by: ["c2"],
            aggregates: [{ as: "amount", fn: "sum", column: "c3" }],
          },
        ]),
        [d],
        [],
      ),
    /partition/,
  );
  assert.throws(
    () => executePlan(plan(d, [{ op: "select", columns: ["c3"] }]), [d], []),
    /partition/,
  );
});
test("finance: budget versus actual and missing budgets", () => {
  const actual = fixture("Actual", [
      ["Category", "Amount"],
      ["Food", 80],
      ["Travel", 20],
    ]),
    budget = fixture("Budget", [
      ["Category", "Planned"],
      ["Food", 100],
    ]);
  const rel: Relationship = {
    id: randomUUID(),
    leftDataset: actual.id,
    leftColumn: "c1",
    rightDataset: budget.id,
    rightColumn: "c1",
    cardinality: "many-to-one",
  };
  const r = executePlan(
    {
      stages: [
        { id: "budget", datasetId: budget.id, steps: [] },
        {
          id: "actual",
          datasetId: actual.id,
          steps: [
            {
              op: "join",
              right: "budget",
              relationshipId: rel.id,
              kind: "left",
            },
            {
              op: "derive",
              as: "variance",
              operator: "subtract",
              left: { column: "c2" },
              right: { column: "budget.c2" },
            },
          ],
        },
      ],
      output: "actual",
    },
    [actual, budget],
    [rel],
  );
  assert.deepEqual(
    r.rows.map((r) => r.variance),
    ["-20", null],
  );
});
function database() {
  const path = mkdtempSync(join(tmpdir(), "siaas-structured-"));
  const db = new LocalDatabase(path);
  const project = db.put("projects", {
    tenant_id: LOCAL_USER_ID,
    name: "Test",
  });
  const assistant = db.put("assistants", {
    tenant_id: LOCAL_USER_ID,
    project_id: project.id,
    name: "A",
  });
  return {
    path,
    db,
    assistant,
    project,
    cleanup() {
      db.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
async function csv(
  db: LocalDatabase,
  assistantId: string,
  text = "Code,Amount\nA,2\nA,3",
) {
  const id = randomUUID(),
    bytes = Buffer.from(text);
  const doc = db.put("documents", {
    id,
    tenant_id: LOCAL_USER_ID,
    assistant_id: assistantId,
    title: "local.csv",
    kind: "csv",
    byte_size: bytes.length,
    storage_path: db.managedPath(assistantId, id, "local.csv", "csv"),
  });
  saveImportedFile(db, id, bytes);
  await importStructured(db, id);
  return doc;
}
test("local import, mapping persistence, isolation, relationship validation and deletion", async () => {
  const f = database();
  try {
    const doc = await csv(f.db, f.assistant.id);
    const [d] = datasets(f.db, f.assistant.id);
    updateMapping(f.db, f.assistant.id, d.id, {
      ...d.mapping,
      confirmed: true,
    });
    assert.equal(
      queryStructured(
        f.db,
        f.assistant.id,
        plan(d, [
          {
            op: "group",
            by: [],
            aggregates: [{ as: "sum", fn: "sum", column: "c2" }],
          },
        ]),
      ).rows[0].sum,
      "5",
    );
    const b = f.db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: f.project.id,
      name: "B",
    });
    assert.equal(datasets(f.db, b.id).length, 0);
    assert.throws(() => queryStructured(f.db, b.id, plan(d)), /authorized/);
    const doc2 = await csv(f.db, f.assistant.id, "Code,Stock\nA,10");
    const d2 = datasets(f.db, f.assistant.id).find(
      (x) => x.documentId === doc2.id,
    )!;
    updateMapping(f.db, f.assistant.id, d2.id, {
      ...d2.mapping,
      confirmed: true,
    });
    saveRelationship(f.db, f.assistant.id, {
      leftDataset: d.id,
      leftColumn: "c1",
      rightDataset: d2.id,
      rightColumn: "c1",
      cardinality: "many-to-one",
    });
    assert.equal(relations(f.db, f.assistant.id).length, 1);
    assert.throws(
      () =>
        saveRelationship(f.db, f.assistant.id, {
          leftDataset: d.id,
          leftColumn: "c1",
          rightDataset: d2.id,
          rightColumn: "c1",
          cardinality: "one-to-one",
        }),
      /unique/,
    );
    removeLocalDocument(f.db, doc.id, true);
    assert.equal(relations(f.db, f.assistant.id).length, 0);
    assert.equal(datasets(f.db, f.assistant.id).length, 1);
  } finally {
    f.cleanup();
  }
});
test("linked files changed after import cannot produce stale totals", async () => {
  const f = database();
  const folder = mkdtempSync(join(tmpdir(), "siaas-linked-"));
  try {
    writeFileSync(join(folder, "data.csv"), "Code,Amount\nA,2");
    const linked = connectFolder(f.db, f.assistant.id, folder, false);
    await importStructured(f.db, linked.queued[0]);
    const [d] = datasets(f.db, f.assistant.id);
    updateMapping(f.db, f.assistant.id, d.id, {
      ...d.mapping,
      confirmed: true,
    });
    writeFileSync(join(folder, "data.csv"), "Code,Amount\nA,3");
    assert.throws(
      () => queryStructured(f.db, f.assistant.id, plan(d)),
      /changed/,
    );
  } finally {
    f.cleanup();
    rmSync(folder, { recursive: true, force: true });
  }
});
test("template import/export keeps models null and strips local data", () => {
  for (const key of ["production-planning", "personal-finance"]) {
    const template = BUILTIN_TEMPLATES[key];
    assert(template, `${key} must be synced into application`);
    const f = database();
    try {
      const result = importLocalTemplate(f.db, template);
      const assistant = f.db.get("assistants", result.assistantIds[0])!;
      assert.equal(assistant.model_id, null);
      assert.equal(datasets(f.db, assistant.id).length, 0);
      const portable = templateBundle({
        ...template,
        datasets: [{ private: "secret" }],
        assistants: template.assistants.map((a) => ({
          ...a,
          absolutePath: "C:/private",
          mappings: { secret: 1 },
          model: "ollama/test",
        })),
      });
      assert(!JSON.stringify(portable).includes("secret"));
      assert(!JSON.stringify(portable).includes("C:/private"));
      assert.equal(
        templateBundleSchema.parse(portable).project.assistants[0].model,
        null,
      );
      assert.match(template.assistants[0].instructions, /partial datasets/);
    } finally {
      f.cleanup();
    }
  }
});
test("production template explicitly rejects optimization claims; finance requires currency safeguards", () => {
  assert.match(
    BUILTIN_TEMPLATES["production-planning"].assistants[0].instructions,
    /no optimization solver/,
  );
  assert.match(
    BUILTIN_TEMPLATES["personal-finance"].assistants[0].instructions,
    /Never combine different currencies/,
  );
});
test("semantic Knowledge remains retrievable alongside structured datasets", async () => {
  const f = database();
  try {
    await csv(f.db, f.assistant.id);
    const doc = f.db.put("documents", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: f.assistant.id,
      title: "Production instructions",
      status: "ready",
    });
    f.db.put("document_chunks", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: f.assistant.id,
      document_id: doc.id,
      position: 0,
      content: "Materials must be kept dry.",
    });
    const sources = await retrieveAssistantSources({
      db: f.db,
      assistantId: f.assistant.id,
      modelId: "ollama/test",
      question: "materials",
      embeddingProfile: null,
      signal: new AbortController().signal,
      emit: () => {},
    });
    assert.equal(sources[0].content, "Materials must be kept dry.");
    assert.equal(datasets(f.db, f.assistant.id).length, 1);
  } finally {
    f.cleanup();
  }
});
test("JSON planning transport validates plans and rejects unsupported model output (mock Ollama)", async () => {
  const f = database();
  try {
    let captured: any;
    const mock: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/api/show"))
        return Response.json({ capabilities: ["completion"] });
      captured = JSON.parse(init!.body as string);
      return Response.json({
        message: {
          content: JSON.stringify({
            status: "clarify",
            message: "Confirm the currency and amount sign convention.",
          }),
        },
      });
    };
    const answer = await planQuestion(
      f.db,
      f.assistant.id,
      "ollama/qwen2.5:1.5b",
      "What did I spend?",
      new AbortController().signal,
      mock,
    );
    assert.equal(answer.status, "clarify");
    assert(captured.format);
    assert.equal(captured.stream, false);
    assert.throws(() =>
      planningSchema.parse({ status: "query", plan: { sql: "SELECT *" } }),
    );
    await assert.rejects(
      planQuestion(
        f.db,
        f.assistant.id,
        "ollama/qwen2.5:1.5b",
        "question",
        new AbortController().signal,
        async (url) =>
          String(url).endsWith("/api/show")
            ? Response.json({ capabilities: ["completion"] })
            : Response.json({ message: { content: "I think it is 42" } }),
      ),
      /invalid plan/,
    );
  } finally {
    f.cleanup();
  }
});

test("merged XLSX cells retain only the anchor value", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Merged");
  ws.addRows([
    ["A", "B"],
    [7, null],
  ]);
  ws.mergeCells("A2:B2");
  const [s] = await parseStructured(
    Buffer.from(await wb.xlsx.writeBuffer()),
    "xlsx",
  );
  assert.equal(s.rows[1][0].value, 7);
  assert.equal(s.rows[1][1].value, null);
  assert.match(s.warnings.join(), /Merged/);
});

test("macro, external-link and oversized expanded archives are rejected", async () => {
  const { createRequire } = await import("node:module");
  const JSZip = createRequire(import.meta.url)("jszip");
  for (const name of [
    "xl/vbaProject.bin",
    "xl/externalLinks/externalLink1.xml",
    "xl/embeddings/object.bin",
  ]) {
    const zip = new JSZip();
    zip.file(name, "test");
    await assert.rejects(
      parseStructured(await zip.generateAsync({ type: "nodebuffer" }), "xlsx"),
      /not supported/,
    );
  }
  const large = new JSZip();
  large.file("xl/data.xml", "a".repeat(33 * 1024 * 1024));
  await assert.rejects(
    parseStructured(
      await large.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
      "xlsx",
    ),
    /resource limits/,
  );
});

test("output byte budget rejects oversized results without truncating totals", () => {
  const d = fixture("wide", [
    ["Text"],
    ...Array.from({ length: 10 }, () => ["x".repeat(8000)]),
  ]);
  assert.throws(() => executePlan(plan(d), [d], []), /64 KB/);
});

test("numeric profile preserves large integer ordering", () => {
  const d = fixture("precise", [
    ["Value"],
    ["9007199254740993"],
    ["9007199254740992"],
  ]);
  const p = profile(d);
  assert.equal(p.columns[0].min, "9007199254740992");
  assert.equal(p.columns[0].max, "9007199254740993");
});

test("numeric equivalent join keys cannot be declared unique", async () => {
  const f = database();
  try {
    await csv(f.db, f.assistant.id, "Key,Amount\n1.0,2\n1,3");
    const d = datasets(f.db, f.assistant.id)[0];
    updateMapping(f.db, f.assistant.id, d.id, {
      ...d.mapping,
      confirmed: true,
    });
    assert.throws(
      () =>
        saveRelationship(f.db, f.assistant.id, {
          leftDataset: d.id,
          leftColumn: "c1",
          rightDataset: d.id,
          rightColumn: "c1",
          cardinality: "one-to-one",
        }),
      /unique/,
    );
  } finally {
    f.cleanup();
  }
});

test("confirmed join cardinality is rechecked after stage transformations", () => {
  const { orders, stock, rel } = manufacturing();
  const r = { ...rel, cardinality: "one-to-one" as const };
  const p = {
    stages: [
      { id: "stock", datasetId: stock.id, steps: [] },
      {
        id: "orders",
        datasetId: orders.id,
        steps: [
          { op: "join", right: "stock", relationshipId: r.id, kind: "left" },
        ],
      },
    ],
    output: "orders",
  };
  assert.throws(() => executePlan(p, [orders, stock], [r]), /cardinality/);
});

test("dataset and relationship records survive restart and cascade with assistant deletion", async () => {
  const f = database();
  try {
    await csv(f.db, f.assistant.id);
    const d = datasets(f.db, f.assistant.id)[0];
    updateMapping(f.db, f.assistant.id, d.id, {
      ...d.mapping,
      confirmed: true,
    });
    const reopened = new LocalDatabase(f.path);
    try {
      assert.equal(
        datasets(reopened, f.assistant.id)[0].mapping.confirmed,
        true,
      );
      reopened.sql
        .prepare("DELETE FROM assistants WHERE id=?")
        .run(f.assistant.id);
      assert.equal(
        reopened.sql
          .prepare("SELECT count(*) n FROM structured_datasets")
          .get()!.n,
        0,
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.cleanup();
  }
});
