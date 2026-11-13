// Legacy black-box characterization. Never launches Electron or touches real profiles.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  copyFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { runtimeAsset } from "../scripts/lib/distribution.mjs";
const BASELINE = "17202c5964d9282efd4a1991c548612287c65dbb";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const oldManager = () =>
  execFileSync("git", ["show", `${BASELINE}:scripts/source-manager.mjs`], {
    encoding: "utf8",
  });

function fixture(managerSource = null, platform = process.platform) {
  const base = mkdtempSync(join(tmpdir(), "siaas-characterization-"));
  const root = join(base, "Application space"),
    scripts = join(base, "entry", "scripts");
  cpSync(resolve("scripts"), scripts, { recursive: true });
  if (managerSource)
    writeFileSync(join(scripts, "source-manager.mjs"), managerSource);
  const runtimeFolder = join(
    root,
    "runtimes",
    `node-v${process.versions.node}-linux-${process.arch}`,
  );
  mkdirSync(join(runtimeFolder, "bin"), { recursive: true });
  const node = join(runtimeFolder, "bin/node"),
    npm = join(runtimeFolder, "npm-fixture.mjs");
  copyFileSync(process.execPath, node);
  const events = join(base, "events.jsonl"),
    launches = join(base, "launches.jsonl");
  writeFileSync(
    npm,
    `import fs from 'node:fs';const pkg=JSON.parse(fs.readFileSync('package.json'));fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),prefix:process.env.NPM_CONFIG_PREFIX??null,node:process.env.SIAAS_SOURCE_NODE})+'\\n');console.log('fixture npm output');if(pkg.failBuild)process.exit(17);if(pkg.interrupt)process.kill(process.ppid,'SIGKILL');`,
  );
  const runtime = {
    folder: runtimeFolder,
    node,
    npm,
    version: process.versions.node,
    binarySha256: hash(readFileSync(node)),
  };
  writeFileSync(join(runtimeFolder, "runtime.json"), JSON.stringify(runtime));
  const hook = join(base, "hook.mjs");
  writeFileSync(
    hook,
    `import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>${JSON.stringify(base)};${platform !== process.platform ? `Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});` : ""}syncBuiltinESMExports();`,
  );
  const env = {
    ...process.env,
    SIAAS_INSTALL_DIR: root,
    APPDATA: join(base, "appdata"),
    LOCALAPPDATA: join(base, "localappdata"),
    NPM_CONFIG_PREFIX: "/must-be-removed",
  };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const run = (args, entry = join(scripts, "source-manager.mjs")) =>
    spawnSync(node, ["--import", hook, entry, ...args], {
      env,
      encoding: "utf8",
      timeout: 20000,
    });
  let counter = 0;
  function prepared(version, options = {}) {
    const dir = join(base, "prepared-" + counter++),
      source = join(dir, "source");
    mkdirSync(source, { recursive: true });
    cpSync(scripts, join(source, "scripts"), { recursive: true });
    if (options.old)
      writeFileSync(join(source, "scripts/source-manager.mjs"), oldManager());
    const executable = `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(launches)},JSON.stringify({args:process.argv.slice(2),root:process.env.SIAAS_INSTALL_DIR,manager:process.env.SIAAS_SOURCE_MANAGER,nodeOptions:process.env.NODE_OPTIONS??null})+'\\n');`;
    mkdirSync(join(source, "node_modules/electron-builder"), {
      recursive: true,
    });
    writeFileSync(
      join(source, "node_modules/electron-builder/cli.js"),
      `const fs=require('node:fs');fs.mkdirSync('dist/unpacked',{recursive:true});fs.writeFileSync('dist/unpacked/siaas',${JSON.stringify(executable)},{mode:0o755});console.log('fixture builder output');`,
    );
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({
        version,
        failBuild: !!options.failBuild,
        interrupt: !!options.interrupt,
      }),
    );
    writeFileSync(
      join(source, "runtime.json"),
      JSON.stringify({ nodeVersion: process.versions.node }),
    );
    const archive = join(dir, "source.zip");
    assert.equal(
      spawnSync("zip", ["-qr", archive, "."], { cwd: source }).status,
      0,
    );
    const bytes = readFileSync(archive),
      name = `SIAAS-Personal-${version}-source.zip`;
    const manifest = {
      schemaVersion: 1,
      version,
      platform: "linux",
      arch: process.arch,
      name,
      size: bytes.length,
      sha256: hash(bytes),
      downloadUrl: `https://github.com/siaas-software/siaas-personal/releases/download/v${version}/${name}`,
      runtime: {
        version: process.versions.node,
        ...runtimeAsset(process.versions.node, "linux", process.arch),
        sha256: "a".repeat(64),
      },
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    return ["--prepared", dir, "--manifest", join(dir, "manifest.json")];
  }
  const readEvents = (path) =>
    existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  const state = () =>
    JSON.parse(readFileSync(join(root, "current.json"), "utf8"));
  async function launched(count) {
    for (let i = 0; i < 100 && readEvents(launches).length < count; i++)
      await delay(20);
    assert.equal(readEvents(launches).length, count);
  }
  return {
    base,
    root,
    scripts,
    runtime,
    run,
    prepared,
    state,
    launched,
    events,
    launches,
    readEvents,
    env,
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

async function scenario(managerSource) {
  const f = fixture(managerSource);
  const trace = [];
  const normalize = (value) =>
    JSON.parse(
      JSON.stringify(value)
        .replaceAll(f.base, "<temporary>")
        .replace(/(\d+\.\d+\.\d+(?:-rc\.\d+)?)-\d{10,}/g, "$1-<timestamp>")
        .replaceAll(f.runtime.binarySha256, "<runtime-hash>"),
    );
  const capture = (label, r) => {
    if (label === "fresh" && r.status !== 0) assert.fail(r.stdout + r.stderr);
    trace.push({
      label,
      status: r.status,
      signal: r.signal,
      stdout: r.stdout,
      stderr: r.stderr,
    });
    return r;
  };
  try {
    assert.equal(capture("empty status", f.run(["status"])).stdout, "null\n");
    assert.equal(capture("unsupported", f.run(["capabilities"])).status, 1);
    assert.equal(capture("missing app", f.run(["launch"])).status, 1);
    const first = f.prepared("1.2.0", { old: true });
    assert.equal(
      capture(
        "fresh",
        f.run(["install", ...first, "--unrecognized-legacy-option"]),
      ).status,
      0,
    );
    await f.launched(1);
    trace.push({
      state: f.state(),
      launcher: readFileSync(
        join(f.base, ".local/share/applications/siaas-personal.desktop"),
        "utf8",
      ),
      dispatcher: readFileSync(join(f.root, "source-manager.mjs"), "utf8"),
    });
    writeFileSync(join(f.root, "user-data-sentinel"), "preserve");
    const before = f.readEvents(f.events).length;
    assert.equal(capture("repeat", f.run(["install", ...first])).status, 0);
    assert.equal(f.readEvents(f.events).length, before);
    await delay(80);
    assert.equal(f.readEvents(f.launches).length, 1);
    assert.equal(
      capture("update", f.run(["update", ...f.prepared("1.3.0")])).status,
      0,
    );
    await f.launched(2);
    const dispatcher = join(f.root, "source-manager.mjs");
    assert.equal(
      capture("new dispatcher status", f.run(["status"], dispatcher)).status,
      0,
    );
    assert.equal(
      capture("rollback new to old", f.run(["rollback"], dispatcher)).status,
      0,
    );
    assert.equal(f.state().version, "1.2.0");
    assert.equal(
      capture("old dispatcher status", f.run(["status"], dispatcher)).status,
      0,
    );
    assert.equal(
      capture("rollback old to new", f.run(["rollback"], dispatcher)).status,
      0,
    );
    const stable = readFileSync(
      join(f.base, ".local/share/applications/siaas-personal.desktop"),
      "utf8",
    );
    assert.equal(
      capture("candidate", f.run(["install", ...f.prepared("1.4.0-rc.1")]))
        .status,
      0,
    );
    await f.launched(3);
    assert.equal(f.state().profile, join(f.root, "profile"));
    assert.equal(
      readFileSync(
        join(f.base, ".local/share/applications/siaas-personal.desktop"),
        "utf8",
      ),
      stable,
    );
    trace.push({
      state: f.state(),
      rcLauncher: readFileSync(join(f.root, "launch-rc.sh"), "utf8"),
    });
    mkdirSync(f.state().profile, { recursive: true });
    writeFileSync(join(f.state().profile, "data"), "preserve profile");
    const prior = f.state();
    assert.equal(
      capture(
        "failed build",
        f.run(["install", ...f.prepared("1.5.0", { failBuild: true })]),
      ).status,
      1,
    );
    assert.deepEqual(f.state(), prior);
    assert.equal(
      capture("invalid pid", f.run(["update-detached", "0"])).status,
      1,
    );
    mkdirSync(join(f.root, ".operation-lock"));
    assert.equal(capture("busy", f.run(["uninstall"])).status, 1);
    assert.deepEqual(f.state(), prior);
    rmSync(join(f.root, ".operation-lock"), { recursive: true });
    trace.push({
      events: f.readEvents(f.events),
      launches: f.readEvents(f.launches),
    });
    assert.equal(
      capture("uninstall", f.run(["uninstall"], dispatcher)).status,
      0,
    );
    assert(!existsSync(join(f.root, "launch-rc.sh")));
    assert(
      existsSync(
        join(f.base, ".local/share/applications/siaas-personal.desktop"),
      ),
    );
    assert.equal(capture("repeat uninstall", f.run(["uninstall"])).status, 0);
    // Legacy fallback after current.json is removed selects the stable launcher.
    assert(
      !existsSync(
        join(f.base, ".local/share/applications/siaas-personal.desktop"),
      ),
    );
    assert.equal(
      readFileSync(join(f.root, "user-data-sentinel"), "utf8"),
      "preserve",
    );
    assert.equal(
      readFileSync(join(f.root, "profile/data"), "utf8"),
      "preserve profile",
    );
    assert(!existsSync(join(f.root, "current.json")));
    return normalize(trace);
  } finally {
    f.dispose();
  }
}

test(
  "legacy transcript, launch/build arguments, metadata and retained dispatchers match pinned baseline",
  { skip: process.platform !== "linux" },
  async () => {
    const expected = await scenario(oldManager());
    const actual = await scenario(null);
    assert.deepEqual(actual, expected);
    const fresh = actual.find((x) => x.label === "fresh");
    assert.deepEqual(
      fresh.stdout
        .split("\n")
        .filter((x) => x.startsWith("SIAAS_PROGRESS "))
        .map((x) => JSON.parse(x.slice(15)).phase),
      [
        "checking",
        "runtime",
        "downloading",
        "installing",
        "building",
        "completed",
      ],
    );
    const repeated = actual.find((x) => x.label === "repeat");
    assert.match(repeated.stdout, /Already installed: 1.2.0/);
    const calls = actual.find((x) => x.events).events;
    assert(calls.every((x) => x.prefix === null));
    assert.deepEqual(
      calls.slice(0, 3).map((x) => x.argv.slice(3)),
      [
        ["ci", "--no-audit", "--no-fund"],
        ["run", "desktop:build"],
        ["run", "desktop:prepare"],
      ],
    );
    const launches = actual.find((x) => x.launches).launches;
    assert.deepEqual(launches[0].args, []);
    assert.deepEqual(launches[2].args, [
      "--user-data-dir=<temporary>/Application space/profile",
    ]);
  },
);

test(
  "interrupted legacy build leaves lock/stage and refuses retry without changing metadata",
  { skip: process.platform !== "linux" },
  async () => {
    for (const manager of [oldManager(), null]) {
      const f = fixture(manager);
      try {
        assert.equal(f.run(["install", ...f.prepared("1.2.0")]).status, 0);
        await f.launched(1);
        const prior = f.state();
        const r = f.run([
          "update",
          ...f.prepared("1.3.0", { interrupt: true }),
        ]);
        assert.equal(r.signal, "SIGKILL");
        assert.deepEqual(f.state(), prior);
        assert(existsSync(join(f.root, ".operation-lock")));
        assert(readdirSync(f.root).some((x) => x.startsWith("stage-")));
        const retry = f.run(["update"]);
        assert.equal(retry.status, 1);
        assert.match(retry.stderr, /Another operation is running/);
      } finally {
        f.dispose();
      }
    }
  },
);

test(
  "platform launcher paths and profile selection match legacy without native app execution",
  { skip: process.platform !== "linux" },
  () => {
    for (const platform of ["linux", "darwin", "win32"])
      for (const candidate of [false, true]) {
        const outputs = [];
        for (const manager of [oldManager(), null]) {
          const f = fixture(manager, platform);
          try {
            const previous = {
              version: "1.2.0",
              tag: "v1.2.0",
              folder: "previous",
              runtime: f.runtime,
              ...(candidate ? { profile: join(f.root, "profile") } : {}),
            };
            const suffix =
              platform === "win32"
                ? "SIAAS Personal.exe"
                : platform === "darwin"
                  ? "SIAAS Personal.app/Contents/MacOS/SIAAS Personal"
                  : "siaas";
            const binary = join(
              f.root,
              "versions/previous/dist/unpacked",
              suffix,
            );
            mkdirSync(resolve(binary, ".."), { recursive: true });
            writeFileSync(binary, "not executed");
            writeFileSync(
              join(f.root, "current.json"),
              JSON.stringify({
                ...previous,
                folder: "current",
                version: "1.3.0",
                previous,
              }),
            );
            const r = f.run(["rollback"]);
            assert.equal(r.status, 0, r.stderr);
            const path = candidate
              ? join(
                  f.root,
                  platform === "win32" ? "launch-rc.cmd" : "launch-rc.sh",
                )
              : platform === "win32"
                ? join(
                    f.base,
                    "appdata/Microsoft/Windows/Start Menu/Programs/SIAAS Personal.cmd",
                  )
                : platform === "darwin"
                  ? join(f.base, "Applications/SIAAS Personal.command")
                  : join(
                      f.base,
                      ".local/share/applications/siaas-personal.desktop",
                    );
            outputs.push(
              readFileSync(path, "utf8").replaceAll(f.base, "<temporary>"),
            );
          } finally {
            f.dispose();
          }
        }
        assert.equal(outputs[0], outputs[1]);
      }
  },
);

test(
  "default roots and status side effects remain unchanged on simulated platforms",
  { skip: process.platform !== "linux" },
  () => {
    for (const platform of ["linux", "darwin", "win32"])
      for (const manager of [oldManager(), null]) {
        const f = fixture(manager, platform);
        try {
          delete f.env.SIAAS_INSTALL_DIR;
          const expected =
            platform === "win32"
              ? join(f.base, "localappdata/SIAAS Personal Source")
              : join(f.base, ".local/share/siaas-personal-source");
          assert(!existsSync(expected));
          const r = f.run(["status"]);
          assert.equal(r.status, 0, r.stderr);
          assert.equal(r.stdout, "null\n");
          assert(existsSync(expected));
          const unknown = f.run(["--help"]);
          assert.equal(unknown.status, 1);
          assert.equal(
            unknown.stderr,
            "SIAAS: Expected install, update, check, launch, rollback, status or uninstall.\n",
          );
        } finally {
          f.dispose();
        }
      }
  },
);

test(
  "separate stable and candidate roots preserve both registrations and user data",
  { skip: process.platform !== "linux" },
  async () => {
    for (const manager of [oldManager(), null]) {
      const stable = fixture(manager),
        candidate = fixture(manager);
      try {
        // Share only the simulated OS home, as the real stable/RC installers do.
        writeFileSync(
          join(candidate.base, "hook.mjs"),
          `import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>${JSON.stringify(stable.base)};syncBuiltinESMExports();`,
        );
        assert.equal(
          stable.run(["install", ...stable.prepared("1.2.0")]).status,
          0,
        );
        await stable.launched(1);
        const state = stable.state(),
          path = join(
            stable.base,
            ".local/share/applications/siaas-personal.desktop",
          );
        const launcher = readFileSync(path, "utf8");
        writeFileSync(join(stable.root, "user-data"), "stable sentinel");
        assert.equal(
          candidate.run(["install", ...candidate.prepared("1.3.0-rc.1")])
            .status,
          0,
        );
        await candidate.launched(1);
        assert.equal(
          candidate.state().profile,
          join(candidate.root, "profile"),
        );
        mkdirSync(candidate.state().profile, { recursive: true });
        writeFileSync(
          join(candidate.state().profile, "data"),
          "candidate sentinel",
        );
        assert.equal(candidate.run(["uninstall"]).status, 0);
        assert.equal(readFileSync(path, "utf8"), launcher);
        assert.deepEqual(stable.state(), state);
        assert.equal(
          readFileSync(join(stable.root, "user-data"), "utf8"),
          "stable sentinel",
        );
        assert.equal(
          readFileSync(join(candidate.root, "profile/data"), "utf8"),
          "candidate sentinel",
        );
      } finally {
        candidate.dispose();
        stable.dispose();
      }
    }
  },
);

test(
  "corrupt prepared inputs fail before build and preserve the active generation",
  { skip: process.platform !== "linux" },
  async () => {
    for (const manager of [oldManager(), null]) {
      const f = fixture(manager);
      try {
        assert.equal(f.run(["install", ...f.prepared("1.2.0")]).status, 0);
        await f.launched(1);
        const state = f.state(),
          count = f.readEvents(f.events).length;
        for (const fault of ["size", "digest"]) {
          const args = f.prepared("1.3.0"),
            manifest = JSON.parse(readFileSync(args[3], "utf8"));
          if (fault === "size") manifest.size++;
          else manifest.sha256 = "0".repeat(64);
          writeFileSync(args[3], JSON.stringify(manifest));
          const r = f.run(["update", ...args]);
          assert.equal(r.status, 1);
          assert.equal(
            r.stderr,
            "SIAAS: Source archive integrity verification failed.\n",
          );
          assert.deepEqual(f.state(), state);
          assert.equal(f.readEvents(f.events).length, count);
          assert(!existsSync(join(f.root, ".operation-lock")));
          assert(!readdirSync(f.root).some((x) => x.startsWith("stage-")));
        }
        assert.equal(f.readEvents(f.launches).length, 1);
      } finally {
        f.dispose();
      }
    }
  },
);

test(
  "launcher registration failure restores metadata and leaves the built generation as legacy does",
  { skip: process.platform !== "linux" },
  async () => {
    for (const manager of [oldManager(), null]) {
      const f = fixture(manager);
      try {
        assert.equal(f.run(["install", ...f.prepared("1.2.0")]).status, 0);
        await f.launched(1);
        const state = f.state(),
          launcher = join(
            f.base,
            ".local/share/applications/siaas-personal.desktop",
          );
        rmSync(launcher);
        mkdirSync(launcher); // A disposable fixture-only write failure.
        const r = f.run(["update", ...f.prepared("1.3.0")]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /^SIAAS: EISDIR:/);
        assert.deepEqual(f.state(), state);
        assert.equal(f.readEvents(f.launches).length, 1);
        assert(
          readdirSync(join(f.root, "versions")).some((x) =>
            x.startsWith("1.3.0-"),
          ),
        );
        assert(!existsSync(join(f.root, ".operation-lock")));
        assert(!readdirSync(f.root).some((x) => x.startsWith("stage-")));
      } finally {
        f.dispose();
      }
    }
  },
);

test(
  "CLI-managed install and update activate verified fixtures without launching GUI",
  { skip: process.platform !== "linux" },
  async () => {
    const f = fixture();
    try {
      const first = f.run(["install-cli", ...f.prepared("1.7.0-rc.1")]);
      assert.equal(first.status, 0, first.stdout + first.stderr);
      assert.equal(f.state().version, "1.7.0-rc.1");
      assert.match(first.stdout, /"launched":false/);
      assert(existsSync(join(f.root, "launch-rc.sh")));
      await delay(100);
      assert.deepEqual(f.readEvents(f.launches), []);

      const second = f.run(["update-cli", ...f.prepared("1.7.0-rc.2")]);
      assert.equal(second.status, 0, second.stdout + second.stderr);
      assert.equal(f.state().version, "1.7.0-rc.2");
      assert.equal(f.state().previous.version, "1.7.0-rc.1");
      await delay(100);
      assert.deepEqual(f.readEvents(f.launches), []);
      const repeat = f.run(["install-cli", ...f.prepared("1.7.0-rc.2")]);
      assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr);
      assert.match(repeat.stdout, /Already installed/);
      assert.deepEqual(f.readEvents(f.launches), []);

      // Legacy entry point intentionally retains its old launch behavior.
      const legacy = f.run(["install", ...f.prepared("1.7.0-rc.3")]);
      assert.equal(legacy.status, 0, legacy.stdout + legacy.stderr);
      await f.launched(1);
      assert.equal(f.state().version, "1.7.0-rc.3");
    } finally {
      f.dispose();
    }
  },
);

test(
  "CLI-managed preflight rejects unprepared requests and update without install",
  { skip: process.platform !== "linux" },
  () => {
    const f = fixture();
    try {
      const invalid = f.run(["install-cli", "--manifest", "/unused", "--prepared", "/unused"]);
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /requires explicit prepared source and manifest/);
      assert(!existsSync(join(f.root, "current.json")));

      const missing = f.run(["update-cli", ...f.prepared("1.7.0")]);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /No existing installation to update/);
      assert(!existsSync(join(f.root, "current.json")));
      assert.deepEqual(f.readEvents(f.launches), []);
    } finally {
      f.dispose();
    }
  },
);
