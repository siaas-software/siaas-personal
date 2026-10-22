import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (process.env.GITHUB_REF_NAME !== `v${version}`)
  throw new Error("Tag and package version must match");
for (const target of ["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64"]) {
  const manifest = JSON.parse(
    await readFile(`release/update-${target}.json`, "utf8"),
  );
  if (manifest.version !== version || !manifest.files.length)
    throw new Error("Invalid release manifest");
  for (const f of manifest.files) {
    if (!/^SIAAS-Personal-[\w.-]+$/.test(f.url)) throw new Error("Invalid filename");
    const path = "release/" + f.url;
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (
      hash.digest("base64") !== f.sha512 ||
      (await stat(path)).size !== f.size
    )
      throw new Error(`Corrupt artifact: ${f.url}`);
  }
}
if (!(await readdir("release")).some((f) => f.endsWith(".deb")))
  throw new Error("Missing Debian installer");
console.log(`All release artifacts verified for v${version}`);
