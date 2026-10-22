// Creates local source-distribution artifacts. Does not tag, publish, or upload.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { stableVersion, runtimeAsset } from "./lib/distribution.mjs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const runtime = JSON.parse(readFileSync("runtime.json", "utf8"));
if (!stableVersion(pkg.version))
  throw Error("A stable package version is required.");
runtimeAsset(runtime.nodeVersion, "linux", "x64");
const status = spawnSync(
  "git",
  ["status", "--porcelain", "--untracked-files=no"],
  { encoding: "utf8" },
);
if (status.status !== 0 || status.stdout.trim())
  throw Error(
    "Commit tracked changes before creating source release artifacts.",
  );
mkdirSync("dist-source", { recursive: true });
const prefix = `SIAAS-Personal-${pkg.version}`;
const archive = spawnSync(
  "git",
  [
    "archive",
    "--format=zip",
    "--output",
    join("dist-source", prefix + "-source.zip"),
    "HEAD",
  ],
  { stdio: "inherit" },
);
if (archive.error || archive.status !== 0)
  throw Error("Source archive creation failed.");
writeFileSync(
  join("dist-source", prefix + "-install.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      version: pkg.version,
      nodeVersion: runtime.nodeVersion,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Created local source.zip and install.json artifacts in dist-source. Publication requires separate authorization.",
);
const assets = [prefix + "-source.zip", prefix + "-install.json"];
for (const extension of ["ps1", "sh"]) {
  const name = `install-siaas.${extension}`;
  copyFileSync(`scripts/install.${extension}`, join("dist-source", name));
  assets.push(name);
}
writeFileSync(join("dist-source", "SHA256SUMS.txt"), assets.map(name =>
  createHash("sha256").update(readFileSync(join("dist-source", name))).digest("hex") + "  " + name,
).join("\n") + "\n");
