import { build } from "esbuild";
import { mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

export async function buildStructuredParser(
  destination = ".next/standalone/scripts",
) {
  const result = await build({
    entryPoints: ["scripts/structured-parser.cjs"],
    outfile: join(destination, "structured-parser.cjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    legalComments: "eof",
    metafile: true,
  });
  // Keep original license/notice files for every dependency included in the worker.
  const roots = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/);
    if (match) roots.add(match[1]);
  }
  rmSync(join(destination, "structured-licenses"), { recursive: true, force: true });
  const inventory = [];
  for (const root of roots) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const notices = [];
    for (const name of readdirSync(root)) {
      if (!/^(licen[cs]e|notice|copying)(?:[.-].*)?$/i.test(name)) continue;
      const target = join(
        destination,
        "structured-licenses",
        root.replaceAll("/", "_"),
        name,
      );
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, name), target, { recursive: true });
      notices.push(name);
    }
    inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license || null, notices });
  }
  mkdirSync(join(destination, "structured-licenses"), { recursive: true });
  writeFileSync(join(destination, "structured-licenses", "manifest.json"),
    JSON.stringify(inventory.sort((a, b) => a.name.localeCompare(b.name)), null, 2) + "\n");
}
if (process.argv.includes("--standalone")) await buildStructuredParser();
