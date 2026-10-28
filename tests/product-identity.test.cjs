const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

function startIdentity(profile = "", platform = "linux") {
  const events = [];
  const app = {
    commandLine: { getSwitchValue: () => profile },
    getPath: (name) => {
      assert.equal(name, "appData");
      return "/existing-profile";
    },
    setPath: (name, path) => events.push([name, path]),
    setName: (name) => events.push(["name", name]),
    setAppUserModelId: (id) => events.push(["appId", id]),
    requestSingleInstanceLock: () => false,
    quit: () => {},
  };
  runInNewContext(
    readFileSync(join(__dirname, "../desktop/main.cjs"), "utf8"),
    {
      process: { platform },
      require: (name) => {
        if (name === "electron") return { app };
        if (name === "node:path") return require("node:path");
        if (name === "node:fs")
          return { mkdirSync: (path) => events.push(["mkdir", path]) };
        return {};
      },
    },
  );
  return events;
}

test("renaming the app preserves the existing workspace directory", () => {
  assert.deepEqual(startIdentity(), [
    ["mkdir", "/existing-profile/SIAAS"],
    ["userData", "/existing-profile/SIAAS"],
    ["name", "SIAAS Personal"],
  ]);
});

test("an explicit Electron profile stays isolated from existing user data", () => {
  assert.deepEqual(startIdentity("/isolated-profile"), [
    ["mkdir", "/isolated-profile"],
    ["userData", "/isolated-profile"],
    ["name", "SIAAS Personal"],
  ]);
});

test("Windows uses the packaged application identity without changing the data profile", () => {
  assert.deepEqual(startIdentity("/isolated-profile", "win32"), [
    ["mkdir", "/isolated-profile"],
    ["userData", "/isolated-profile"],
    ["name", "SIAAS Personal"],
    ["appId", "it.siaas.desktop"],
  ]);
});
