// Read-only lockfile inventory. This is evidence, not a license compatibility verdict.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const lockPath = resolve(arg("--lock", "package-lock.json"));
const modules = resolve(arg("--modules", dirname(lockPath)));
const output = resolve(arg("--out", "docs/licensing/dependency-inventory.json"));
const label = arg("--label", "reviewed checkout");
const bytes = readFileSync(lockPath), lock = JSON.parse(bytes);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const direct = new Set(Object.keys({...lock.packages[""].dependencies, ...lock.packages[""].devDependencies}));
const packages = Object.entries(lock.packages).filter(([path]) => path).map(([path, p]) => {
  const name = p.name || path.split("node_modules/").at(-1);
  const dir = join(modules, path);
  let manifest, licenses = [];
  if (existsSync(join(dir, "package.json"))) {
    manifest = JSON.parse(readFileSync(join(dir, "package.json")));
    if (manifest.version === p.version) {
      licenses = readdirSync(dir, {withFileTypes:true})
        .filter(f => f.isFile() && /^(licen[cs]e|notice|copying)([.-]|$)/i.test(f.name))
        .map(f => ({file:f.name, sha256:sha256(readFileSync(join(dir,f.name)))}));
    } else manifest = undefined;
  }
  const license = p.license || "NOT DECLARED";
  let obligations = "Retain original license, copyright and attribution; inspect the exact text.";
  if (/LGPL/.test(license)) obligations = "Retain notices; verify corresponding source, modifications and replacement/relinking requirements for the distributed artifact.";
  else if (/Apache/.test(license)) obligations = "Include license, retain attribution/NOTICE where present, and mark modified upstream files; preserve all AND-license terms.";
  else if (/OFL/.test(license)) obligations = "Include font copyright/OFL; retain reserved font name restrictions for modifications; no sale of font alone.";
  else if (/CC-BY/.test(license)) obligations = "Provide attribution, license link and indication of changes for redistributed data.";
  else if (license === "NOT DECLARED") obligations = "Unresolved: obtain artifact-specific permission or replace/remove before redistribution.";
  return {name, version:p.version, path, direct:direct.has(name) && path === "node_modules/" + name,
    scope:p.dev ? "development" : "runtime", optional:!!p.optional,
    license, source:p.resolved || "lockfile has no resolved URL", integrity:p.integrity || null,
    upstream:manifest?.repository || null, licenseFiles:licenses,
    evidence:licenses.length ? "MATCHING LICENSE FILE HASHED" : "METADATA ONLY — TEXT NOT VERIFIED", obligations};
}).sort((a,b)=>a.path.localeCompare(b.path, "en"));
const counts = Object.fromEntries([...new Set(packages.map(p=>p.license))].sort().map(l=>[l,packages.filter(p=>p.license===l).length]));
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({schemaVersion:1,label,lockSha256:sha256(bytes),
  limitations:"Includes all locked platform alternatives. Installed text is inspected only at matching versions. Native subcomponents, model weights and dynamic Python dependencies require separate inventories. No legal clearance is implied.",counts,packages},null,2)+"\n");
console.log(`${label}: ${packages.length} entries; ${packages.filter(p=>!p.licenseFiles.length).length} without matching local license text; ${output}`);
