import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import snapshot from "../src/generated/builtin-templates.json";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
test("sync validates semantic/legacy catalogs, subsets, hashes and reproducibility", () => {
  const directory = mkdtempSync(join(tmpdir(), "siaas-sync-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "src/lib"), { recursive: true });
    cpSync(
      "scripts/sync-templates.mjs",
      join(directory, "scripts/sync-templates.mjs"),
    );
    cpSync(
      "src/lib/project-colors.ts",
      join(directory, "src/lib/project-colors.ts"),
    );
    const configPath = join(directory, "templates-source.json");
    const outputPath = join(directory, "output.json");
    const catalogPath = join(directory, "catalog.json");
    const config = {
      repository: "siaas-software/siaas-templates",
      ref: "a".repeat(40),
      path: "catalog.json",
      target: "app",
      output: "output.json",
    };
    const catalog = {
      version: 1,
      templates: Object.entries(snapshot).map(([id, project]) => ({
        id,
        format: "siaas-project-v1",
        project: { ...project },
        listing: { description: { en: "Test", it: "Test" }, category: "Work" },
      })),
    };
    const write = (value: unknown, path = catalogPath) =>
      writeFileSync(path, JSON.stringify(value));
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          join(directory, "scripts/sync-templates.mjs"),
          ...args,
        ],
        { cwd: resolve("."), encoding: "utf8" },
      );
    const sync = () => run("--catalog", catalogPath);
    write(config, configPath);
    write(catalog);
    assert.equal(sync().status, 0);
    const output = readFileSync(outputPath, "utf8");
    assert.deepEqual(JSON.parse(output), snapshot);
    const pinned = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(pinned.catalogSha256, hash(readFileSync(catalogPath, "utf8")));
    assert.equal(pinned.outputSha256, hash(output));
    assert.equal(sync().status, 0);
    assert.equal(readFileSync(outputPath, "utf8"), output);
    assert.equal(run("--check").status, 0);
    writeFileSync(outputPath, output + " ");
    assert.notEqual(run("--check").status, 0);
    assert.equal(sync().status, 0);
    for (const templateIds of [
      ["personal-finance"],
      ["personal-finance", "personal-finance"],
      ["missing"],
    ]) {
      write({ ...config, templateIds }, configPath);
      assert.equal(
        sync().status === 0,
        templateIds.length === 1 && templateIds[0] === "personal-finance",
      );
    }
    write(config, configPath);
    const legacy = structuredClone(catalog);
    for (const item of legacy.templates)
      delete (item.project as { palette?: string }).palette;
    write(legacy);
    assert.equal(sync().status, 0);
    assert(
      Object.values(JSON.parse(readFileSync(outputPath, "utf8"))).every(
        (p) => !("palette" in (p as object)),
      ),
    );
    const saved = readFileSync(outputPath, "utf8");
    for (const palette of ["unknown", null, 42]) {
      write({
        ...catalog,
        templates: catalog.templates.map((t, i) =>
          i ? t : { ...t, project: { ...t.project, palette } },
        ),
      });
      const result = sync();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unknown project palette/);
      assert.equal(readFileSync(outputPath, "utf8"), saved);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
