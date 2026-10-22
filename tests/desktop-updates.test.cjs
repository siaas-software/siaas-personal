const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { DesktopUpdates } = require("../desktop/updates.cjs");

test("source updates work without an account, report failures and never install on check", async () => {
  let calls = 0;
  const states = [];
  const updates = new DesktopUpdates({
    version: "1.2.0",
    supported: true,
    notify: (state) => states.push(state.phase),
    request: async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://api.github.com/repos/siaas-software/siaas-personal/releases/latest",
      );
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({
        tag_name: "v1.3.0",
        draft: false,
        prerelease: false,
        html_url:
          "https://github.com/siaas-software/siaas-personal/releases/tag/v1.3.0",
      });
    },
  });
  assert.equal((await updates.check()).phase, "available");
  assert.equal(updates.state.nextVersion, "1.3.0");
  assert.deepEqual(states, ["checking", "available"]);
  updates.version = "1.3.0";
  assert.equal((await updates.check()).phase, "current");
  updates.request = async () => {
    throw new Error("Offline");
  };
  assert.equal((await updates.check()).phase, "failed");
  assert.equal(updates.state.message, "Offline");
  assert.equal(updates.pending, false);
  updates.request = async () =>
    Response.json({ tag_name: "v1.4.0", prerelease: true });
  assert.equal((await updates.check()).phase, "failed");
  updates.supported = false;
  assert.equal((await updates.check()).phase, "unsupported");
  assert.equal(calls, 2);
});

test("preload exposes only local and update actions; listeners unsubscribe", async () => {
  let bridge;
  const invoked = [],
    listeners = new Map();
  runInNewContext(readFileSync("desktop/preload.cjs", "utf8"), {
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            assert.equal(name, "siaasDesktop");
            bridge = value;
          },
        },
        ipcRenderer: {
          invoke: async (channel, ...args) => {
            invoked.push([channel, ...args]);
          },
          on: (channel, callback) => listeners.set(channel, callback),
          removeListener: (channel, callback) => {
            assert.equal(listeners.get(channel), callback);
            listeners.delete(channel);
          },
        },
      };
    },
  });
  assert(
    !Object.keys(bridge).some((key) =>
      /account|signIn|signOut|skill/i.test(key),
    ),
  );
  await bridge.checkUpdate();
  await bridge.installUpdate();
  assert.deepEqual(invoked, [["siaas:check-update"], ["siaas:install-update"]]);
  let received;
  const unsubscribe = bridge.onUpdateState((state) => (received = state));
  listeners.get("siaas:update-state")({}, { phase: "current" });
  assert.equal(received.phase, "current");
  unsubscribe();
  assert.equal(listeners.size, 0);
});
