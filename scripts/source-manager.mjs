// Source distribution manager. Renderer access remains behind the native update confirmation.
import { spawnSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { resolveManifest, validateManifest, compareVersions } from "./lib/distribution.mjs";
import {
  provisionRuntime,
  verifyRuntime,
  runtimeEnv,
  download,
  sha256,
} from "./lib/managed-runtime.mjs";
const action = process.argv[2];
const root = resolve(
  process.env.SIAAS_INSTALL_DIR ||
    (process.platform === "win32"
      ? join(
          process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
          "SIAAS Personal Source",
        )
      : join(homedir(), ".local", "share", "siaas-personal-source")),
);
const versions = join(root, "versions"),
  current = join(root, "current.json"),
  lock = join(root, ".operation-lock");
const managerFile = join(root, "source-manager.mjs");
const emit = (phase, message) =>
  console.log("SIAAS_PROGRESS " + JSON.stringify({ phase, message }));
const installed = () =>
  existsSync(current) ? JSON.parse(readFileSync(current, "utf8")) : null;
function folder(item) {
  if (
    !item ||
    typeof item.folder !== "string" ||
    /[/\\]/.test(item.folder) ||
    item.folder === ".." ||
    isAbsolute(item.folder)
  )
    throw Error("Invalid installed version record.");
  return join(versions, item.folder);
}
function run(command, args, cwd, runtime) {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: runtimeEnv(runtime.node),
  });
  if (r.error || r.status !== 0)
    throw Error(
      `Installation command failed: ${r.error?.message || r.status}. The previous installation remains available.`,
    );
}
function executable(path) {
  const base = join(path, "dist");
  if (!existsSync(base))
    throw Error(
      "The installed application is incomplete. Rerun the installer.",
    );
  const suffix =
    process.platform === "win32"
      ? "SIAAS Personal.exe"
      : process.platform === "darwin"
        ? "SIAAS Personal.app/Contents/MacOS/SIAAS Personal"
        : "siaas";
  const match = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(base, e.name, suffix))
    .find(existsSync);
  if (!match) throw Error("The built desktop executable is missing.");
  return match;
}
function launcherFile() {
  if (installed()?.profile) return join(root, process.platform === "win32" ? "launch-rc.cmd" : "launch-rc.sh");
  return process.platform === "win32"
    ? join(
        process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "SIAAS Personal.cmd",
      )
    : process.platform === "darwin"
      ? join(homedir(), "Applications", "SIAAS Personal.command")
      : join(
          homedir(),
          ".local",
          "share",
          "applications",
          "siaas-personal.desktop",
        );
}
function launcher(item) {
  const node = item.runtime.node,
    manager = join(folder(item), "scripts", "source-manager.mjs");
  if ([node, manager, root].some((p) => /[\r\n%]/.test(p)))
    throw Error(
      "Installation paths cannot contain newlines or percent characters.",
    );
  const sh = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  const desktop = (s) =>
    '"' +
    s
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("`", "\\`")
      .replaceAll("$", "\\$") +
    '"';
  let body;
  if (process.platform === "win32")
    body = `@echo off\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\nset "SIAAS_INSTALL_DIR=${root}"\r\n"${node}" "${manager}" launch\r\n`;
  else if (process.platform === "darwin" || item.profile)
    body = `#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nexport SIAAS_INSTALL_DIR=${sh(root)}\nexec ${sh(node)} ${sh(manager)} launch\n`;
  else
    body = `[Desktop Entry]\nType=Application\nName=SIAAS Personal\nExec=env -u NODE_OPTIONS -u NODE_PATH ${desktop("SIAAS_INSTALL_DIR=" + root)} ${desktop(node)} ${desktop(manager)} launch\nTerminal=false\nCategories=Office;\n`;
  mkdirSync(dirname(launcherFile()), { recursive: true });
  writeFileSync(launcherFile(), body, { mode: 0o755 });
  writeFileSync(join(root, "runtime-path"), node + "\n");
}
function atomicWrite(data) {
  writeFileSync(current + ".tmp", JSON.stringify(data, null, 2));
  renameSync(current + ".tmp", current);
}
const snapshot = (item) =>
  item
    ? Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== "previous"),
      )
    : null;
async function launch(item) {
  if (!item) throw Error("SIAAS Personal is not installed.");
  await verifyRuntime(item.runtime, item.runtime?.version);
  const manager = join(folder(item), "scripts", "source-manager.mjs");
  const child = spawn(executable(folder(item)), item.profile ? ["--user-data-dir=" + item.profile] : [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...runtimeEnv(item.runtime.node),
      SIAAS_INSTALL_DIR: root,
      SIAAS_SOURCE_MANAGER: manager,
    },
    windowsHide: false,
  });
  await new Promise((ok, no) => {
    child.once("spawn", ok);
    child.once("error", no);
  });
  child.unref();
}
function cleanup(item) {
  const keep = new Set([item.folder, item.previous?.folder]);
  for (const name of readdirSync(versions))
    if (/^\d+\.\d+\.\d+(?:-rc\.\d+)?-\d+$/.test(name) && !keep.has(name)) {
      try {
        rmSync(join(versions, name), { recursive: true, force: true });
      } catch {}
    }
  const runtimes = join(root, "runtimes");
  if (!existsSync(runtimes)) return;
  const kept = [
    item.runtime?.node,
    item.previous?.runtime?.node,
    process.execPath,
  ].filter(Boolean);
  for (const name of readdirSync(runtimes)) {
    const p = join(runtimes, name);
    if (
      /^node-v\d+\.\d+\.\d+-(win32|darwin|linux)-(x64|arm64)$/.test(name) &&
      !kept.some((n) =>
        n.startsWith(p + (process.platform === "win32" ? "\\" : "/")),
      )
    ) {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {}
    }
  }
}
const newer = (a, b) => compareVersions(a, b) > 0;
async function install() {
  emit(
    "checking",
    "Checking the public stable release. Ensure at least 10 GB free disk space.",
  );
  const args = process.argv;
  const manifestFile = args.includes("--manifest")
    ? args[args.indexOf("--manifest") + 1]
    : null;
  const prepared = args.includes("--prepared")
    ? args[args.indexOf("--prepared") + 1]
    : null;
  const manifest = validateManifest(
    manifestFile
      ? JSON.parse(readFileSync(manifestFile, "utf8"))
      : await resolveManifest(process.platform, process.arch),
  );
  const old = installed();
  if (old && newer(old.version, manifest.version))
    throw Error(
      "The public release is older than the installed version. Use rollback explicitly; automatic downgrade is refused.",
    );
  if (old?.runtime && !newer(manifest.version, old.version)) {
    await verifyRuntime(old.runtime, old.runtime?.version);
    launcher(old);
    console.log("Already installed: " + old.version);
    return;
  }
  emit("runtime", "Verifying the application-managed Node.js runtime");
  const runtime = await provisionRuntime(root, manifest.runtime);
  const id = manifest.version + "-" + Date.now(),
    stage = join(root, "stage-" + id),
    source = join(stage, "source"),
    dest = join(versions, id);
  mkdirSync(source, { recursive: true });
  try {
    const archive = prepared
      ? join(resolve(prepared), "source.zip")
      : join(stage, "source.zip");
    emit("downloading", "Downloading and verifying the release source");
    if (!prepared)
      await download(
        manifest.downloadUrl,
        archive,
        manifest.sha256,
        manifest.size,
      );
    const { statSync } = await import("node:fs");
    if (
      statSync(archive).size !== manifest.size ||
      (await sha256(archive)) !== manifest.sha256
    )
      throw Error("Source archive integrity verification failed.");
    if (process.platform === "win32")
      run(
        join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
        ["-xf", archive, "-C", source],
        stage,
        runtime,
      );
    else run("unzip", ["-q", archive, "-d", source], stage, runtime);
    const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const required = JSON.parse(
      readFileSync(join(source, "runtime.json"), "utf8"),
    );
    if (
      pkg.version !== manifest.version ||
      required.nodeVersion !== runtime.version
    )
      throw Error("Release source and installation manifest disagree.");
    emit(
      "installing",
      "Installing application dependencies with the managed runtime",
    );
    const npm = (args) =>
      run(
        runtime.node,
        [runtime.npm, "--prefix", source, "--global=false", ...args],
        source,
        runtime,
      );
    npm(["ci", "--no-audit", "--no-fund"]);
    emit("building", "Building SIAAS Personal");
    npm(["run", "desktop:build"]);
    npm(["run", "desktop:prepare"]);
    run(
      runtime.node,
      [
        join(source, "node_modules/electron-builder/cli.js"),
        "--config",
        "electron-builder.cjs",
        "--dir",
        "--publish",
        "never",
      ],
      source,
      runtime,
    );
    executable(source);
    mkdirSync(versions, { recursive: true });
    renameSync(source, dest);
    const next = {
      version: manifest.version,
      ...((old?.profile || manifest.version.includes("-rc.")) ? { profile: old?.profile || join(root, "profile") } : {}),
      tag: "v" + manifest.version,
      folder: id,
      runtime,
      previous: snapshot(old),
    };
    // Each release retains its own manager so rollback selects matching app, manager and runtime.
    writeFileSync(
      managerFile,
      `// Stable dispatcher: select the active release's own source manager.
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
try {
 const root=dirname(fileURLToPath(import.meta.url));
 const item=JSON.parse(readFileSync(join(root,'current.json'),'utf8'));
 if(typeof item.folder!=='string'||item.folder.includes('/')||item.folder.includes(String.fromCharCode(92))||item.folder==='..')throw Error('Invalid active installation.');
 process.env.SIAAS_INSTALL_DIR=root;
 await import(pathToFileURL(join(root,'versions',item.folder,'scripts','source-manager.mjs')).href);
} catch(error) {console.error('SIAAS: '+error.message);process.exitCode=1;}
`,
    );
    atomicWrite(next);
    try {
      launcher(next);
    } catch (error) {
      if (old) {
        atomicWrite(old);
        if (old.runtime) launcher(old);
      } else rmSync(current, { force: true });
      throw error;
    }
    cleanup(next);
    emit("completed", "Activated SIAAS Personal " + manifest.version);
    await launch(next);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
async function main() {
  mkdirSync(root, { recursive: true });
  if (action === "status") {
    console.log(JSON.stringify(installed()));
    return;
  }
  if (action === "launch") {
    await launch(installed());
    return;
  }
  if (action === "check") {
    const m = await resolveManifest(process.platform, process.arch),
      i = installed();
    console.log(
      JSON.stringify({
        installed: i?.version || null,
        latest: m.version,
        available: !i || newer(m.version, i.version),
      }),
    );
    return;
  }
  if (
    !["install", "update", "update-detached", "rollback", "uninstall"].includes(
      action,
    )
  )
    throw Error(
      "Expected install, update, check, launch, rollback, status or uninstall.",
    );
  try {
    mkdirSync(lock);
  } catch {
    throw Error(
      "Another operation is running. Inspect " +
        lock +
        " before removing a stale lock.",
    );
  }
  try {
    if (action === "rollback") {
      const i = installed();
      if (!i?.previous) throw Error("No previous version is available.");
      executable(folder(i.previous));
      await verifyRuntime(i.previous.runtime, i.previous.runtime?.version);
      const next = { ...i.previous, previous: snapshot(i) };
      atomicWrite(next);
      try {
        launcher(next);
      } catch (error) {
        atomicWrite(i);
        throw error;
      }
      console.log(
        "Rolled back application and runtime. Data migrations are NOT reversed.",
      );
      return;
    }
    if (action === "uninstall") {
      rmSync(launcherFile(), { force: true });
      rmSync(current, { force: true });
      console.log(
        "Launcher unregistered. Application versions and all user data are preserved.",
      );
      return;
    }
    if (action === "update-detached") {
      const pid = Number(process.argv[3]);
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw Error("Invalid process ID.");
      let alive = true;
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (alive) throw Error("SIAAS Personal did not exit before the update.");
    }
    await install();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error("SIAAS: " + error.message);
  process.exitCode = 1;
});
