import assert from "node:assert/strict";
import { isProjectPaletteKey } from "../src/lib/project-colors.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = resolve(root, "templates-source.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  assert(args[i + 1] && !args[i + 1].startsWith("--"), `${name} needs a value`);
  return args[i + 1];
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const outputPath = resolve(root, config.output);

if (args.includes("--check")) {
  assert.match(config.ref, /^[a-f0-9]{40}$/);
  assert.equal(
    hash(await readFile(outputPath)),
    config.outputSha256,
    "Generated templates changed. Run templates:sync instead of editing snapshots.",
  );
  console.log(`Template snapshot verified: ${config.repository}@${config.ref}`);
} else {
  const ref = option("--ref") ?? config.ref;
  assert.match(ref, /^[a-f0-9]{40}$/, "Use an immutable full commit SHA.");
  const localPath = option("--catalog");
  let raw;
  if (localPath) {
    raw = await readFile(resolve(localPath), "utf8");
  } else {
    // Credentials are used only in this maintainer command, never in app/browser code.
    const token = process.env.SIAAS_TEMPLATES_TOKEN ?? process.env.GITHUB_TOKEN;
    const response = await fetch(
      `https://api.github.com/repos/${config.repository}/contents/${config.path}?ref=${ref}`,
      {
        headers: {
          Accept: "application/vnd.github.raw+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    assert(
      response.ok,
      `Catalog fetch failed (${response.status}). For a private repository, use SIAAS_TEMPLATES_TOKEN or --catalog with an authenticated local checkout.`,
    );
    raw = await response.text();
  }
  const catalog = JSON.parse(raw);
  assert([1, 2].includes(catalog.version), "Unsupported catalog version");
  assert(Array.isArray(catalog.templates) && catalog.templates.length > 0);
  const ids = new Set();
  for (const template of catalog.templates) {
    assert.match(template.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert(!ids.has(template.id), "Duplicate template ID");
    ids.add(template.id);
    assert.equal(template.format, `siaas-project-v${catalog.version}`);
    assert(template.project.name && Array.isArray(template.project.assistants));
    assert(
      template.project.assistants.length > 0 &&
        template.project.assistants.length <= 50,
    );
    assert.match(template.project.color, /^#[0-9a-f]{6}$/i);
    for (const assistant of template.project.assistants) {
      assert(assistant.name && assistant.description && assistant.instructions);
      assert.equal(assistant.model, null);
      assert(
        Array.isArray(assistant.sources) && assistant.sources.length <= 100,
      );
      for (const source of assistant.sources) {
        const url = new URL(source);
        assert(
          ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password,
        );
      }
      assert.deepEqual(Object.keys(assistant).sort(), [
        "description",
        "instructions",
        "model",
        "name",
        "sources",
      ]);
    }
    if (template.project.palette !== undefined)
      assert(
        isProjectPaletteKey(template.project.palette),
        "Unknown project palette",
      );
    if (catalog.version === 2) {
      const o = template.project.orchestration;
      assert(o && typeof o === "object");
      assert.deepEqual(Object.keys(o).sort(), ["assistant_indices", "enabled", "instructions", "max_steps", "share_results"]);
      assert.equal(typeof o.enabled, "boolean");
      assert.equal(typeof o.share_results, "boolean");
      assert.equal(typeof o.instructions, "string");
      assert(o.instructions.length <= 4000);
      assert(Number.isInteger(o.max_steps) && o.max_steps >= 1 && o.max_steps <= 8);
      assert(Array.isArray(o.assistant_indices) && o.assistant_indices.length <= 8);
      assert.equal(new Set(o.assistant_indices).size, o.assistant_indices.length);
      for (const index of o.assistant_indices)
        assert(Number.isInteger(index) && index >= 0 && index < template.project.assistants.length);
      assert(!o.enabled || (o.assistant_indices.length > 0 && o.assistant_indices.length <= o.max_steps));
    }
    assert.deepEqual(
      Object.keys(template.project).filter((key) => key !== "palette").sort(),
      catalog.version === 2
        ? ["assistants", "color", "description", "name", "orchestration"]
        : ["assistants", "color", "description", "name"],
    );
    assert(template.listing.description.en && template.listing.description.it);
    assert(["Education", "Hobby", "Work"].includes(template.listing.category));
  }
  assert(["app", "site"].includes(config.target));
  // Keep adoption explicit when the upstream catalog adds unrelated templates.
  const selected = config.templateIds
    ? catalog.templates.filter(({ id }) => config.templateIds.includes(id))
    : catalog.templates;
  if (config.templateIds) {
    assert.deepEqual(
      selected.map(({ id }) => id).sort(),
      [...config.templateIds].sort(),
      "Unknown or duplicate templateIds",
    );
  }
  const data =
    config.target === "app"
      ? Object.fromEntries(selected.map(({ id, project }) => [id, project]))
      : selected.map(({ id, project, listing }) => ({
          id,
          name: project.name,
          description: listing.description,
          agents: project.assistants.length,
          color: project.color,
          category: listing.category,
          sources: project.assistants.reduce((n, a) => n + a.sources.length, 0),
          assistants: project.assistants.map((a) => a.name),
          bundle: { format: `siaas-project-v${catalog.version}`, project },
        }));
  const output = JSON.stringify(data, null, 2) + "\n";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath + ".tmp", output);
  await rename(outputPath + ".tmp", outputPath);
  await writeFile(
    configPath,
    JSON.stringify(
      { ...config, ref, catalogSha256: hash(raw), outputSha256: hash(output) },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Synced ${selected.length} templates from ${config.repository}@${ref}`,
  );
}
