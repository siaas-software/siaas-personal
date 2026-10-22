import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateManifest,
  targetSchema,
  signedAssetLocation,
} from "../src/lib/desktop-releases";
import { assistantSchema, desktopAssistantSchema } from "../src/lib/validation";
test("release manifests are bound to version and target", () => {
  const payload = {
    tag: "v1.2.0",
    platform: "win32" as const,
    arch: "x64" as const,
  };
  assert.throws(() => targetSchema.parse({ platform: "linux", arch: "arm64" }));
  const m = {
    version: "1.2.0",
    releaseDate: new Date().toISOString(),
    files: [
      {
        url: "SIAAS-Personal-1.2.0-win-x64.exe",
        size: 42,
        sha512: Buffer.alloc(64).toString("base64"),
      },
    ],
  };
  assert.equal(validateManifest(m, payload).path, m.files[0].url);
  const linux = { ...payload, platform: "linux" as const };
  assert.equal(
    validateManifest(
      {
        ...m,
        files: [{ ...m.files[0], url: "SIAAS-Personal-1.2.0-linux-x86_64.AppImage" }],
      },
      linux,
    ).path,
    "SIAAS-Personal-1.2.0-linux-x86_64.AppImage",
  );
  assert.throws(() =>
    validateManifest(
      {
        ...m,
        files: [{ ...m.files[0], url: "SIAAS-Personal-1.2.0-linux-x64.AppImage" }],
      },
      linux,
    ),
  );
  for (const url of [
    "https://attacker.test/a.exe",
    "../other.exe",
    "SIAAS-Personal-1.2.0-mac-x64.zip",
    "SIAAS-Personal-1.1.0-win-x64.exe",
  ])
    assert.throws(() =>
      validateManifest({ ...m, files: [{ ...m.files[0], url }] }, payload),
    );
  assert.throws(() => validateManifest({ ...m, version: "1.3.0" }, payload));
  assert.throws(() =>
    signedAssetLocation(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.test" },
      }),
    ),
  );
  assert.equal(
    signedAssetLocation(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://release-assets.githubusercontent.com/file",
        },
      }),
    ),
    "https://release-assets.githubusercontent.com/file",
  );
});
test("desktop agent starts without a model; cloud creation retains its existing contract", () => {
  assert.equal(desktopAssistantSchema.parse({ name: "Test" }).model_id, null);
  assert.equal(
    assistantSchema.parse({ name: "Test" }).model_id,
    "ollama/qwen2.5:1.5b",
  );
  assert.throws(() =>
    desktopAssistantSchema.parse({ name: "Test", model_id: "unknown" }),
  );
});
