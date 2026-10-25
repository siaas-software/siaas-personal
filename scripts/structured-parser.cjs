// Runs in a disposable worker. No paths, URLs or executable expressions are accepted.
const { parentPort, workerData } = require("node:worker_threads");
// Pinned document reader: avoid the unused streaming reader's legacy dependencies.
const Workbook = require("exceljs/lib/doc/workbook");
const Papa = require("papaparse");
const yauzl = require("yauzl");
const MAX_CELLS = 250000,
  MAX_ROWS = 50000,
  MAX_COLS = 128;
async function checkArchive(bytes) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(new Error("Malformed XLSX archive."));
        let size = 0,
          entries = 0;
        const fail = (message) => {
          zip.close();
          reject(new Error(message));
        };
        zip.on("error", () => fail("Malformed XLSX archive."));
        zip.on("end", resolve);
        zip.on("entry", (entry) => {
          size += entry.uncompressedSize;
          if (++entries > 2000 || size > 32 * 1024 * 1024)
            return fail("Expanded workbook exceeds resource limits.");
          if (
            entry.generalPurposeBitFlag & 1 ||
            /(^\/|\.\.|\\)/.test(entry.fileName)
          )
            return fail("Unsafe or encrypted workbook.");
          if (
            /vbaProject|macrosheets|externalLinks|embeddings|activeX/i.test(
              entry.fileName,
            )
          )
            return fail(
              "Macros, embedded objects and external workbook links are not supported.",
            );
          // Decompress once with a streaming byte check to validate declared ZIP sizes.
          if (entry.fileName.endsWith("/")) return zip.readEntry();
          zip.openReadStream(entry, (err, stream) => {
            if (err) return fail("Malformed workbook entry.");
            let read = 0;
            stream.on("data", (chunk) => {
              read += chunk.length;
              if (read > entry.uncompressedSize || read > 32 * 1024 * 1024) {
                stream.destroy();
                fail("Workbook expansion limit exceeded.");
              }
            });
            stream.on("error", () => fail("Malformed workbook entry."));
            stream.on("end", () => zip.readEntry());
          });
        });
        zip.readEntry();
      },
    );
  });
}
function literal(value) {
  if (value == null) return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime())
      ? value.toISOString().slice(0, 10)
      : null;
  if (typeof value === "string") {
    if (value.length > 8000) throw new Error("Cell exceeds 8000 characters.");
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid numeric cell.");
    return value;
  }
  if (value.richText)
    return literal(value.richText.map((part) => part.text).join(""));
  if (value.text != null) return literal(value.text); // Hyperlink label only; never follow its target.
  return null;
}
async function parse() {
  const bytes = Buffer.from(workerData.bytes);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Error("File must contain data and be at most 10 MB.");
  let sheets;
  if (workerData.kind === "csv") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("CSV must be UTF-8 text.");
    const result = Papa.parse(text, {
      skipEmptyLines: false,
      dynamicTyping: false,
    });
    const errors = result.errors.filter(
      (e) => e.code !== "UndetectableDelimiter",
    );
    if (errors.length) throw new Error("Malformed CSV: " + errors[0].message);
    const rows = result.data;
    if (rows.at(-1)?.length === 1 && rows.at(-1)[0] === "") rows.pop();
    sheets = [
      {
        name: "CSV",
        rows: rows.map((row) =>
          row.map((value) => ({ value: value === "" ? null : literal(value) })),
        ),
        warnings: [],
      },
    ];
  } else if (workerData.kind === "xlsx") {
    await checkArchive(bytes);
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes, {
      ignoreNodes: ["drawing", "picture", "extLst"],
    });
    if (workbook.worksheets.length > 20)
      throw new Error("Maximum 20 worksheets per file.");
    sheets = workbook.worksheets.map((ws) => {
      if (
        ws.rowCount > MAX_ROWS ||
        ws.columnCount > MAX_COLS ||
        ws.rowCount * ws.columnCount > MAX_CELLS
      )
        throw new Error("Worksheet exceeds row, column or cell limits.");
      const rows = [];
      for (let r = 1; r <= ws.rowCount; r++) {
        const row = [];
        for (let c = 1; c <= ws.columnCount; c++) {
          const cell = ws.getCell(r, c),
            v = cell.value;
          if (cell.isMerged && cell.master.address !== cell.address) {
            row.push({ value: null });
            continue;
          }
          if (
            v &&
            typeof v === "object" &&
            ("formula" in v || "sharedFormula" in v)
          ) {
            row.push({
              value: null,
              formula: cell.formula || v.sharedFormula,
              cached: literal(cell.result),
              ...(cell.result?.error ? { error: cell.result.error } : {}),
            });
          } else
            row.push({
              value: literal(v),
              ...(v?.error ? { error: v.error } : {}),
            });
        }
        rows.push(row);
      }
      const warnings =
        ws.state !== "visible"
          ? ["Hidden worksheet imported; review before use."]
          : [];
      if (ws.model.merges?.length)
        warnings.push(
          "Merged cells: only the top-left value is retained; other cells remain empty.",
        );
      return { name: ws.name, rows, warnings };
    });
  } else throw new Error("Supported structured formats: XLSX and UTF-8 CSV.");
  let cells = 0;
  for (const sheet of sheets) {
    const columns = Math.max(
      0,
      ...sheet.rows.slice(0, MAX_ROWS + 1).map((r) => r.length),
    );
    if (sheet.rows.length > MAX_ROWS || columns > MAX_COLS)
      throw new Error("Maximum 50000 rows and 128 columns per sheet.");
    cells += sheet.rows.length * columns;
    if (cells > MAX_CELLS)
      throw new Error("Maximum 250000 cells per workbook.");
    if (sheet.rows.some((r) => r.length !== columns))
      sheet.warnings.push(
        "Rows have different column counts; absent cells remain empty.",
      );
  }
  if (
    !sheets.some((s) =>
      s.rows.some((r) => r.some((c) => c.value !== null || c.formula)),
    )
  )
    throw new Error("No data found in file.");
  return sheets;
}
parse().then(
  (sheets) => parentPort.postMessage({ sheets }),
  (e) => parentPort.postMessage({ error: e.message || "Import failed." }),
);
