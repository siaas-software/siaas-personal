// Source distribution manager. Renderer access remains behind the native update confirmation.
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolveManifest, validateManifest, compareVersions } from "./lib/distribution.mjs";
import { provisionRuntime, verifyRuntime } from "./lib/managed-runtime.mjs";
import { createSourceState } from "./lib/source-state.mjs";
import { createSourceDesktop, executable } from "./lib/source-desktop.mjs";
import { buildSource } from "./lib/source-build.mjs";
const action = process.argv[2];
const state = createSourceState();
const { root, versions, current, lock, managerFile, installed, folder, atomicWrite, snapshot, cleanup } = state;
const { launcherFile, launcher, launch } = createSourceDesktop(state);
const emit = (phase, message) =>
  console.log("SIAAS_PROGRESS " + JSON.stringify({ phase, message }));
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
    await buildSource({ manifest, prepared, stage, source, runtime, emit });
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
      // Without an active record, launcherFile would select the global stable
      // launcher even for an already-unregistered RC root. Do not infer ownership.
      if (installed()) rmSync(launcherFile(), { force: true });
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
