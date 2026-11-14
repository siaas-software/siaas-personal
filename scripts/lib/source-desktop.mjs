// Internal legacy launcher registration and automatic application startup.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { verifyRuntime, runtimeEnv } from "./managed-runtime.mjs";

export function executable(path) {
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

export function createSourceDesktop({ root, installed, folder }) {
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
  async function launch(item) {
    if (!item) throw Error("SIAAS Personal is not installed.");
    let locked = false;
    if (item.cliManaged === 1) { mkdirSync(join(root,".operation-lock")); locked = true; }
    try {
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
    } finally { if (locked) rmSync(join(root,".operation-lock"),{recursive:true}); }
  }
  return { launcherFile, launcher, launch };
}
