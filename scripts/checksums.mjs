import { readdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const files = (await readdir("dist"))
  .filter((name) => /\.(exe|dmg|zip|AppImage|deb)$/.test(name))
  .sort();
const lines = [];
for (const file of files) {
  const hash = createHash("sha256");
  for await (const part of createReadStream("dist/" + file)) hash.update(part);
  lines.push(`${hash.digest("hex")}  ${file}`);
}
await writeFile(
  `dist/SHA256SUMS-${process.platform}-${process.arch}.txt`,
  lines.join("\n") + "\n",
);
