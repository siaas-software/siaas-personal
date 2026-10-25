// Creates local source-distribution artifacts. Does not tag, publish, or upload.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { releaseVersion, runtimeAsset } from "./lib/distribution.mjs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const runtime = JSON.parse(readFileSync("runtime.json", "utf8"));
if (!releaseVersion(pkg.version))
  throw Error("A stable or rc.N package version is required.");
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

if (pkg.version.includes("-rc.")) {
  const sums = await fetch(`https://nodejs.org/dist/v${runtime.nodeVersion}/SHASUMS256.txt`, {signal:AbortSignal.timeout(30000)});
  if (!sums.ok) throw Error("Official runtime checksums unavailable");
  const hashes = new Map((await sums.text()).trim().split(/\r?\n/).map(l=>{const [h,n]=l.trim().split(/\s+/);return [n,h]}));
  const bytes=readFileSync(join("dist-source",prefix+"-source.zip"));
  const all={}, lines=[];
  for(const platform of ["win32","darwin","linux"]) for(const arch of ["x64","arm64"]) {
    const r=runtimeAsset(runtime.nodeVersion,platform,arch), sha=hashes.get(r.name);
    if(!/^[a-f0-9]{64}$/.test(sha||""))throw Error("Missing runtime hash");
    const m={schemaVersion:1,version:pkg.version,platform,arch,name:prefix+"-source.zip",size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),downloadUrl:`https://github.com/siaas-software/siaas-personal/releases/download/v${pkg.version}/${prefix}-source.zip`,runtime:{version:runtime.nodeVersion,...r,sha256:sha}};
    all[platform+"-"+arch]=m;
    lines.push([platform,arch,m.version,m.name,m.size,m.sha256,m.downloadUrl,m.runtime.version,m.runtime.name,m.runtime.sha256,m.runtime.url].join("\t"));
  }
  writeFileSync(join("dist-source","rc-manifests.json"),JSON.stringify(all,null,2)+"\n");
  writeFileSync(join("dist-source","rc-manifests.tsv"),lines.join("\n")+"\n");
  assets.push("rc-manifests.json","rc-manifests.tsv");
  for(const ext of ["ps1","sh"]){const name="install-rc."+ext;copyFileSync("scripts/"+name,join("dist-source",name));assets.push(name);}
}

writeFileSync(join("dist-source", "SHA256SUMS.txt"), assets.map(name =>
  createHash("sha256").update(readFileSync(join("dist-source", name))).digest("hex") + "  " + name,
).join("\n") + "\n");
