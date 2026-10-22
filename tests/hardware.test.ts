import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recommendations,
  parameterSize,
  sizeProfiles,
} from "../src/lib/hardware";
import type { CatalogModel } from "../src/lib/model-catalog";
const model = (id: string, extra = {}): CatalogModel => ({
  id,
  name: id,
  family: id.split(":")[0],
  ...extra,
});
const catalog = [
  model("tiny:1b-q4_K_M"),
  model("medium:7b-q4_K_M"),
  model("large:14b-q8_0"),
  model("custom:latest"),
];
const pc = { ram: 16, gpu: "cpu" as const, vram: 24, disk: 100 };
test("RAM, disk and VRAM are separate constraints; unified memory counted once", () => {
  assert(
    recommendations({ ...pc, ram: 4, gpu: "dedicated" }, catalog).every(
      (m) => !m.fits,
    ),
  );
  assert(recommendations({ ...pc, disk: 1 }, catalog).every((m) => !m.fits));
  assert.equal(
    recommendations({ ...pc, gpu: "dedicated", vram: 4 }, catalog)[1]
      .accelerated,
    false,
  );
  assert.equal(
    recommendations({ ...pc, gpu: "unified", vram: 0 }, catalog)[1].accelerated,
    true,
  );
  assert.equal(recommendations(pc, catalog)[1].accelerated, false);
});
test("sizes use actual catalog tags across families, decimals, M and total MoE parameters", () => {
  assert.equal(parameterSize(model("mix:8x7b")), 56);
  assert.equal(parameterSize(model("small:135m")), 0.135);
  assert.equal(parameterSize(model("small:1.5b-instruct")), 1.5);
  assert.equal(parameterSize(model("unknown:latest")), undefined);
  assert.equal(parameterSize(model("custom:latest", { parameterB: 6.5 })), 6.5);
  const profiles = sizeProfiles(recommendations(pc, catalog));
  assert.deepEqual(
    profiles.map((p) => p.sizes),
    [[1], [7], []],
  );
  assert(!recommendations(pc, catalog).some((m) => m.id.includes("qwen")));
  assert.deepEqual(
    sizeProfiles(recommendations(pc, [])).map((p) => p.sizes),
    [[], [], []],
  );
});
test("quantization, metadata and context overhead affect fit, not just B", () => {
  const options = recommendations(pc, [
    model("a:7b-q4_K_M"),
    model("b:7b-q8_0"),
    model("c:7b"),
    model("d:7b", { downloadGB: 3, memoryGB: 6 }),
  ]);
  assert.deepEqual(
    options.map((m) => m.fits),
    [true, false, false, true],
  );
  assert.equal(options[0].downloadGB, 4.2);
  assert.equal(options[0].memoryGB, 7.1);
  assert.equal(options[0].ramGB, 11.1);
  assert.equal(options[0].diskGB, 10);
  assert.equal(options[2].downloadGB, 16.8);
  assert.equal(options[3].estimated, false);
  assert(recommendations({ ...pc, ram: NaN }, catalog).every((m) => !m.fits));
  const boundary = options[0];
  assert(
    recommendations({ ...pc, ram: boundary.ramGB, disk: boundary.diskGB }, [
      model("a:7b-q4_K_M"),
    ])[0].fits,
  );
  assert(
    !recommendations({ ...pc, ram: boundary.ramGB - 0.1 }, [
      model("a:7b-q4_K_M"),
    ])[0].fits,
  );
});
test("a compatible size never implies every quantization at that size fits", () => {
  const profiles = sizeProfiles(
    recommendations(pc, [model("a:7b-q4_K_M"), model("b:7b-fp32")]),
  );
  assert.deepEqual(profiles[1].sizes, [7]);
  assert.equal(profiles[1].entries.length, 2);
  assert.equal(profiles[1].compatible.length, 1);
});
