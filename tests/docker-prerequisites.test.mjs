import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDocker,
  inspectDocker,
} from "../scripts/docker-prerequisites.mjs";
test("missing Docker produces actionable OS-specific errors without starting or installing it", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const calls = [];
    assert.throws(
      () =>
        checkDocker({
          platform,
          run: (cmd, args) => {
            calls.push([cmd, args]);
            return { error: { code: "ENOENT" } };
          },
        }),
      (error) =>
        /not found/.test(error.message) &&
        error.message.includes(
          platform === "linux" ? "Docker Engine" : "Docker Desktop",
        ) &&
        /without Docker/.test(error.message),
    );
    assert.deepEqual(calls, [["docker", ["--version"]]]);
  }
});
test("missing Compose and stopped daemon are distinguished", () => {
  for (const failure of [1, 2]) {
    let n = 0;
    assert.throws(
      () =>
        checkDocker({
          run: () => ({ status: n++ === failure ? 1 : 0, stdout: "2.30.0" }),
        }),
      failure === 1 ? /Compose is unavailable/ : /daemon is unavailable/,
    );
  }
});
test("process execution failures and timeouts have friendly diagnostics", () =>
  assert.throws(
    () => checkDocker({ run: () => ({ error: { code: "EACCES" } }) }),
    /execution permissions/,
  ));
test("healthy Docker probes only prerequisites", () => {
  const calls = [];
  checkDocker({
    run: (_c, a) => {
      calls.push(a);
      return {
        status: 0,
        stdout:
          a[0] === "info"
            ? JSON.stringify({
                ServerVersion: "27.0.0",
                OSType: "linux",
                Architecture: "x86_64",
              })
            : "2.30.0",
      };
    },
  });
  assert.deepEqual(calls, [
    ["--version"],
    ["compose", "version", "--short"],
    ["info", "--format", "{{json .}}"],
  ]);
});

for (const reason of ["windows", "old", "architecture", "invalid"]) {
  test(`unsupported Docker capability: ${reason}`, async () => {
    const status = await inspectDocker({
      run: async (_command, args) => ({
        status: 0,
        stdout:
          args[0] !== "info"
            ? "2.30.0"
            : reason === "invalid"
              ? "bad json"
              : JSON.stringify({
                  ServerVersion: reason === "old" ? "19.03.0" : "27.0.0",
                  OSType: reason === "windows" ? "windows" : "linux",
                  Architecture: reason === "architecture" ? "armv7" : "aarch64",
                }),
      }),
    });
    assert.equal(status.ready, false);
    assert.equal(status.reason, "unsupported_engine");
  });
}
test("async detection distinguishes permission, missing CLI, Compose and stopped Engine without any mutations", async () => {
  for (const [index, reason] of [
    [0, "inaccessible"],
    [1, "compose_unavailable"],
    [2, "engine_unavailable"],
  ]) {
    let calls = 0;
    const status = await inspectDocker({
      run: async () => ({
        status: calls++ === index ? 1 : 0,
        stdout: "2.30.0",
      }),
    });
    assert.equal(status.ready, false);
    assert.equal(status.reason, reason);
    assert.equal(calls, index + 1);
  }
  const missing = await inspectDocker({
    run: async () => ({ error: { code: "ENOENT" } }),
  });
  assert.equal(missing.reason, "not_installed");
});
