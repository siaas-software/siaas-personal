import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
const source = readFileSync(new URL("../src/app/icon.svg", import.meta.url));
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const artifact = (name: string) =>
  readFileSync(new URL("../build/" + name, import.meta.url));
test("desktop icon provenance binds every platform artifact to the original hand-and-stars SVG", () => {
  const provenance = JSON.parse(artifact("icon-provenance.json").toString());
  assert.equal(provenance.sourceSha256, digest(source));
  assert.equal(provenance.source, "src/app/icon.svg");
  for (const [name, metadata] of Object.entries(provenance.icons) as [
    string,
    { sha256: string; bytes: number },
  ][]) {
    const bytes = artifact(name);
    assert.equal(digest(bytes), metadata.sha256);
    assert.equal(bytes.length, metadata.bytes);
  }
});
test("Windows ICO contains seven correctly sized images matching the original artwork", async () => {
  const ico = artifact("icon.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  for (let i = 0; i < 7; i++) {
    const at = 6 + i * 16,
      size = ico[at] || 256,
      length = ico.readUInt32LE(at + 8),
      offset = ico.readUInt32LE(at + 12);
    assert(offset >= 118 && offset + length <= ico.length);
    const png = ico.subarray(offset, offset + length),
      meta = await sharp(png).metadata();
    assert.equal(meta.width, size);
    assert.equal(meta.height, size);
    assert(meta.hasAlpha);
    const original = await sharp(source, {
      density: Math.ceil((size / 120) * 72),
    })
      .resize(size, size)
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual(await sharp(png).ensureAlpha().raw().toBuffer(), original);
  }
});
test("macOS ICNS and Linux PNG contain full-size valid raster images", async () => {
  const png = await sharp(artifact("icon.png")).metadata();
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  const icns = artifact("icon.icns");
  assert.equal(icns.subarray(0, 4).toString(), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  let offset = 8;
  const sizes = [];
  while (offset < icns.length) {
    const length = icns.readUInt32BE(offset + 4);
    assert(length > 8 && offset + length <= icns.length);
    const meta = await sharp(
      icns.subarray(offset + 8, offset + length),
    ).metadata();
    sizes.push(meta.width);
    offset += length;
  }
  assert.deepEqual(sizes, [16, 32, 64, 128, 256, 512, 1024]);
});
