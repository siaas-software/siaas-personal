import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Use a stable semantic version");
const os = { win32: "win", darwin: "mac", linux: "linux" }[process.platform];
const extensions =
  process.platform === "win32"
    ? ["exe"]
    : process.platform === "darwin"
      ? ["zip", "dmg"]
      : ["AppImage"];
const artifactArch =
  process.platform === "linux" && process.arch === "x64"
    ? "x86_64"
    : process.arch;
const names = await readdir("dist");
const files = [];
for (const ext of extensions) {
  const name = `SIAAS-Personal-${version}-${os}-${artifactArch}.${ext}`;
  if (!names.includes(name))
    throw new Error(`Missing release artifact: ${name}`);
  const hash = createHash("sha512");
  for await (const chunk of createReadStream("dist/" + name))
    hash.update(chunk);
  files.push({
    url: name,
    sha512: hash.digest("base64"),
    size: (await stat("dist/" + name)).size,
  });
}
await writeFile(
  `dist/update-${process.platform}-${process.arch}.json`,
  JSON.stringify(
    { version, files, releaseDate: new Date().toISOString() },
    null,
    2,
  ),
);
