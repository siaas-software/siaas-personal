// Maintainer-only conversion. The checked-in official SVG is the sole artwork
// source; no redrawing, remote asset fetch, Python or runtime dependency needed.
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = await readFile(new URL("../src/app/icon.svg", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const render = (size) =>
  sharp(source, { density: Math.ceil((size / 120) * 72) })
    .resize(size, size)
    .png()
    .toBuffer();
const images = new Map();
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024])
  images.set(size, await render(size));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
for (let i = 0; i < icoSizes.length; i++) {
  const size = icoSizes[i],
    bytes = images.get(size),
    entry = 6 + i * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
}
const ico = Buffer.concat([header, ...icoSizes.map((s) => images.get(s))]);
const chunks = [];
for (const [code, size] of [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
]) {
  const bytes = images.get(size),
    chunk = Buffer.alloc(8);
  chunk.write(code);
  chunk.writeUInt32BE(8 + bytes.length, 4);
  chunks.push(chunk, bytes);
}
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns");
icnsHeader.writeUInt32BE(8 + chunks.reduce((n, b) => n + b.length, 0), 4);
const artifacts = {
  "icon.png": images.get(1024),
  "icon.ico": ico,
  "icon.icns": Buffer.concat([icnsHeader, ...chunks]),
};
artifacts["icon-provenance.json"] = Buffer.from(
  JSON.stringify(
    {
      source: "src/app/icon.svg",
      sourceSha256: hash(source),
      generator: "scripts/generate-icons.mjs",
      sharpVersion: sharp.versions.sharp,
      icons: Object.fromEntries(
        Object.entries(artifacts).map(([name, bytes]) => [
          name,
          { sha256: hash(bytes), bytes: bytes.length },
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
await mkdir(new URL("../build/", import.meta.url), { recursive: true });
for (const [name, bytes] of Object.entries(artifacts)) {
  const path = new URL("../build/" + name, import.meta.url);
  if (process.argv.includes("--check")) {
    if (!(await readFile(path)).equals(bytes))
      throw new Error(`Stale icon ${name}; run npm run icons:generate`);
  } else await writeFile(path, bytes);
}
console.log(
  `${process.argv.includes("--check") ? "Verified" : "Generated"} PNG, multi-size ICO and ICNS from the original SIAAS SVG (${hash(source)}).`,
);
