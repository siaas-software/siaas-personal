import { build } from "esbuild";
import { mkdirSync, cpSync, readdirSync } from "node:fs";
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
  for (const root of roots) {
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
    }
  }
}
if (process.argv.includes("--standalone")) await buildStructuredParser();
