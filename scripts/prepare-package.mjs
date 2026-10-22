import {
  cp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error(
    "Packaging requires Node 24+ (private runtime with Zstandard support).",
  );
await rm(".desktop", { recursive: true, force: true });
await mkdir(".desktop/app", { recursive: true });
await cp("desktop", ".desktop/app/desktop", { recursive: true });
await cp("LICENSE", ".desktop/app/LICENSE");
await cp("THIRD_PARTY_NOTICES.md", ".desktop/app/THIRD_PARTY_NOTICES.md");
await mkdir(".desktop/app/services/morphic", { recursive: true });
await cp("services/morphic/LICENSE", ".desktop/app/services/morphic/LICENSE");
await cp("services/morphic/NOTICE", ".desktop/app/services/morphic/NOTICE");
await mkdir(".desktop/app/services/laya", { recursive: true });
await cp("services/laya/LICENSE", ".desktop/app/services/laya/LICENSE");
await writeFile(
  ".desktop/app/package.json",
  JSON.stringify(
    {
      name: pkg.name,
      productName: "SIAAS Personal",
      desktopName: "siaas.desktop",
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      main: "desktop/main.cjs",
    },
    null,
    2,
  ),
);
await build({
  entryPoints: ["desktop/main.cjs"],
  outfile: ".desktop/app/desktop/main.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: [
    "electron",
    "./ollama-manager.cjs",
    "./updates.cjs",
  ],
  legalComments: "eof",
});
await mkdir(".desktop/resources/helpers", { recursive: true });
await cp(
  "scripts/backup-desktop.cjs",
  ".desktop/resources/helpers/backup-desktop.cjs",
);
await mkdir(".desktop/resources/runtime", { recursive: true });
await cp(".next/standalone", ".desktop/resources/server", {
  recursive: true,
  dereference: true,
});
const runtime = join(
  ".desktop/resources/runtime",
  process.platform === "win32" ? "node.exe" : "node",
);
await cp(process.execPath, runtime);
await chmod(runtime, 0o755);
await writeFile(
  ".desktop/resources/runtime/version.json",
  JSON.stringify({
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }),
);
// Node's official license also contains third-party notices for the bundled binary.
const license = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
);
if (!license.ok)
  throw new Error("Unable to include the Node.js license; packaging stopped.");
await writeFile(".desktop/resources/runtime/LICENSE", await license.text());
await build({
  entryPoints: ["desktop/install-ollama.cjs"],
  outfile: ".desktop/resources/helpers/install-ollama.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  legalComments: "eof",
});
// Never ship credentials, source maps containing local paths, or machine databases.
async function check(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const p = join(path, entry.name);
    if (
      /^\.env(?:\.|$)/.test(entry.name) ||
      /\.(sqlite|sqlite-wal|sqlite-shm)$/.test(entry.name)
    )
      throw new Error(`Private file in package: ${p}`);
    if (entry.isDirectory()) await check(p);
  }
}
await check(".desktop");
console.log(
  `Packaged private Node ${process.versions.node} (${process.platform}/${process.arch}), compiled server, and Ollama setup helper.`,
);
