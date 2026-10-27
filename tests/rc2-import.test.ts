import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import {
  automaticMapping,
  importQuestions,
} from "../src/lib/structured/import-review";
import { profile } from "../src/lib/structured/profile";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { saveImportedFile } from "../src/lib/local/knowledge";
import {
  datasets,
  importStructured,
  clarifyImport,
  inspectDatasets,
  relationshipCandidates,
  saveRelationship,
  relations,
} from "../src/lib/structured/store";
import { queryStructured } from "../src/lib/structured/service";
const sheet = (rows: unknown[][]) => ({
  name: "Sheet",
  warnings: [],
  rows: rows.map((r) =>
    r.map((value) => ({ value: value as string | number | null })),
  ),
});
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "siaas-import-")),
    db = new LocalDatabase(path);
  const project = db.put("projects", {
    tenant_id: LOCAL_USER_ID,
    name: "Test",
  });
  const assistant = db.put("assistants", {
    tenant_id: LOCAL_USER_ID,
    project_id: project.id,
    name: "Test",
  });
  async function upload(name: string, bytes: Buffer) {
    const id = randomUUID(),
      kind = name.endsWith("xlsx") ? "xlsx" : "csv";
    db.put("documents", {
      id,
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistant.id,
      title: name,
      kind,
      byte_size: bytes.length,
      storage_path: db.managedPath(assistant.id, id, name, kind),
    });
    saveImportedFile(db, id, bytes);
    await importStructured(db, id);
    return id;
  }
  return {
    path,
    db,
    assistant,
    upload,
    close() {
      if (db.sql.isOpen) db.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
test("automatic mapping handles a title, monthly strings, identifiers and currency partitions", () => {
  const s = sheet([
    ["Budget report"],
    ["Month", "Product", "Budget", "Currency"],
    ["2026-10", "001", 35, "EUR"],
  ]);
  const m = automaticMapping(s, "budgets");
  assert.equal(m.headerRow, 2);
  assert(m.confirmed);
  assert.deepEqual(m.partitionColumns, ["c4"]);
  assert.equal(m.types.c1, "text");
  assert.equal(m.types.c2, "text");
  assert.equal(m.types.c3, "number");
});
test("ambiguous headers, dates, mixed values and invalid ISO dates require focused questions", () => {
  for (const s of [
    sheet([
      [1, 2],
      [3, 4],
    ]),
    sheet([
      ["Date", "Amount"],
      ["01/02/2026", 10],
    ]),
    sheet([
      ["Product", "Amount"],
      ["A", 10],
      ["B", "unknown"],
    ]),
    sheet([
      ["Date", "Amount"],
      ["2026-02-30", 10],
    ]),
  ]) {
    const m = automaticMapping(s);
    assert.equal(m.confirmed, false);
    assert(importQuestions(s, m).length > 0);
  }
});
test("date clarification is isolated, validates real dates, and persists across restart", async () => {
  const f = fixture();
  try {
    await f.upload("dates.csv", Buffer.from("Date,Amount\n01/02/2026,10\n"));
    const [d] = datasets(f.db, f.assistant.id);
    assert(!d.mapping.confirmed);
    clarifyImport(f.db, f.assistant.id, d.id, {
      kind: "date",
      column: "c1",
      value: "DMY",
    });
    const [ready] = datasets(f.db, f.assistant.id);
    assert(ready.mapping.confirmed);
    assert.equal(profile(ready).rows[0].values.c1, "2026-02-01");
    f.db.close();
    const reopened = new LocalDatabase(f.path);
    try {
      assert.equal(
        profile(datasets(reopened, f.assistant.id)[0]).rows[0].values.c1,
        "2026-02-01",
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
test("multi-sheet XLSX is ready without mapping; relationships remain suggestions until confirmed", async () => {
  const f = fixture();
  try {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Orders").addRows([
      ["Product", "Quantity"],
      ["A", 10],
      ["A", 5],
    ]);
    wb.addWorksheet("Stock").addRows([
      ["Product", "Available"],
      ["A", 12],
      ["B", 6],
    ]);
    const id = await f.upload(
      "production.xlsx",
      Buffer.from(await wb.xlsx.writeBuffer()),
    );
    const all = datasets(f.db, f.assistant.id);
    assert.equal(all.length, 2);
    assert(all.every((d) => d.mapping.confirmed));
    assert.equal(relations(f.db, f.assistant.id).length, 0);
    const candidates = relationshipCandidates(f.db, f.assistant.id);
    assert.equal(candidates.length, 1);
    const { label, ...candidate } = candidates[0];
    assert(label.includes("Product"));
    const rel = saveRelationship(f.db, f.assistant.id, candidate);
    const orders = all.find((d) => d.worksheet === "Orders")!,
      stock = all.find((d) => d.worksheet === "Stock")!;
    const result = queryStructured(f.db, f.assistant.id, {
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
            {
              op: "join",
              right: "stock",
              relationshipId: rel.id,
              kind: "left",
            },
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
    });
    assert.equal(result.rows[0].shortage, "3");
    assert(JSON.stringify(result.evidence).includes("production.xlsx"));
    await importStructured(f.db, id);
    assert.deepEqual(
      datasets(f.db, f.assistant.id).map((d) => d.id),
      all.map((d) => d.id),
    );
  } finally {
    f.close();
  }
});
test("official RC1 finance and production samples import without configuration and keep currency separation", async () => {
  const f = fixture();
  try {
    for (const name of ["orders", "budgets", "transactions", "duplicates"])
      await f.upload(
        name + ".csv",
        readFileSync(
          new URL(
            `../examples/structured-analysis/${name}.csv`,
            import.meta.url,
          ),
        ),
      );
    const all = datasets(f.db, f.assistant.id);
    assert(all.every((d) => d.mapping.confirmed));
    const d = all.find((d) => d.filename === "transactions.csv")!;
    const result = queryStructured(f.db, f.assistant.id, {
      stages: [
        {
          id: "t",
          datasetId: d.id,
          steps: [
            {
              op: "group",
              by: ["c3", "c5"],
              aggregates: [{ as: "total", fn: "sum", column: "c4" }],
            },
          ],
        },
      ],
      output: "t",
    });
    assert.deepEqual(result.rows, [
      { c3: "income", c5: "EUR", total: "100" },
      { c3: "expense", c5: "EUR", total: "30" },
      { c3: "expense", c5: "USD", total: "4" },
    ]);
    assert.throws(
      () =>
        queryStructured(f.db, f.assistant.id, {
          stages: [
            {
              id: "t",
              datasetId: d.id,
              steps: [
                {
                  op: "group",
                  by: [],
                  aggregates: [{ as: "total", fn: "sum", column: "c4" }],
                },
              ],
            },
          ],
          output: "t",
        }),
      /partition/,
    );
  } finally {
    f.close();
  }
});
test("formula cache consent infers saved numeric results but missing caches cannot be accepted", async () => {
  const f = fixture();
  try {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Cached").addRows([
      ["Product", "Amount"],
      ["A", { formula: "1+2", result: 3 }],
    ]);
    wb.addWorksheet("Missing").addRows([
      ["Product", "Amount"],
      ["A", { formula: "1+2" }],
    ]);
    await f.upload("formulas.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    const all = datasets(f.db, f.assistant.id);
    assert(all.every((d) => !d.mapping.confirmed));
    const cached = all.find((d) => d.worksheet === "Cached")!,
      missing = all.find((d) => d.worksheet === "Missing")!;
    clarifyImport(f.db, f.assistant.id, cached.id, {
      kind: "formula",
      value: "accept",
    });
    const saved = datasets(f.db, f.assistant.id).find(
      (d) => d.id === cached.id,
    )!;
    assert(saved.mapping.confirmed);
    assert.equal(profile(saved).columns[1].type, "number");
    assert.throws(
      () =>
        clarifyImport(f.db, f.assistant.id, missing.id, {
          kind: "formula",
          value: "accept",
        }),
      /Recalculate/,
    );
    assert(
      inspectDatasets(f.db, f.assistant.id)
        .find((d) => d.id === missing.id)!
        .questions.some((q) => q.kind === "formula"),
    );
  } finally {
    f.close();
  }
});

test("official workbook: inventory shortages and BOM material requirements retain file evidence", async () => {
  const f = fixture();
  try {
    await f.upload(
      "orders.csv",
      readFileSync(
        new URL("../examples/structured-analysis/orders.csv", import.meta.url),
      ),
    );
    await f.upload(
      "operations.xlsx",
      readFileSync(
        new URL(
          "../examples/structured-analysis/operations.xlsx",
          import.meta.url,
        ),
      ),
    );
    const all = datasets(f.db, f.assistant.id);
    assert.equal(all.length, 4);
    assert(all.every((d) => d.mapping.confirmed));
    const orders = all.find((d) => d.filename === "orders.csv")!,
      inventory = all.find((d) => d.worksheet === "Inventory")!,
      bom = all.find((d) => d.worksheet === "BOM")!,
      materials = all.find((d) => d.worksheet === "Materials")!;
    const inventoryLink = saveRelationship(f.db, f.assistant.id, {
      leftDataset: orders.id,
      leftColumn: "c1",
      rightDataset: inventory.id,
      rightColumn: "c1",
      cardinality: "one-to-one",
    });
    const stock = queryStructured(f.db, f.assistant.id, {
      stages: [
        { id: "inventory", datasetId: inventory.id, steps: [] },
        {
          id: "orders",
          datasetId: orders.id,
          steps: [
            {
              op: "join",
              right: "inventory",
              relationshipId: inventoryLink.id,
              kind: "left",
            },
            {
              op: "derive",
              as: "shortage",
              operator: "subtract",
              left: { column: "c2" },
              right: { column: "inventory.c2" },
            },
          ],
        },
      ],
      output: "orders",
    });
    assert.deepEqual(
      stock.rows.map((r) => r.shortage),
      ["2", "-4"],
    );
    const bomLink = saveRelationship(f.db, f.assistant.id, {
      leftDataset: orders.id,
      leftColumn: "c1",
      rightDataset: bom.id,
      rightColumn: "c1",
      cardinality: "one-to-one",
    });
    const materialsLink = saveRelationship(f.db, f.assistant.id, {
      leftDataset: bom.id,
      leftColumn: "c2",
      rightDataset: materials.id,
      rightColumn: "c1",
      cardinality: "many-to-one",
    });
    const demand = queryStructured(f.db, f.assistant.id, {
      stages: [
        { id: "bom", datasetId: bom.id, steps: [] },
        { id: "materials", datasetId: materials.id, steps: [] },
        {
          id: "demand",
          datasetId: orders.id,
          steps: [
            {
              op: "join",
              right: "bom",
              relationshipId: bomLink.id,
              kind: "left",
            },
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
              aggregates: [{ as: "required", fn: "sum", column: "required" }],
            },
            {
              op: "join",
              right: "materials",
              relationshipId: materialsLink.id,
              kind: "left",
            },
            {
              op: "derive",
              as: "shortage",
              operator: "subtract",
              left: { column: "required" },
              right: { column: "materials.c2" },
            },
          ],
        },
      ],
      output: "demand",
    });
    assert.equal(demand.rows[0].required, "25");
    assert.equal(demand.rows[0].shortage, "5");
    assert(JSON.stringify(demand.evidence).includes("operations.xlsx"));

  } finally {
    f.close();
  }
});
