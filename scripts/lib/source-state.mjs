// Internal legacy installation state. No adapter protocol or migration semantics.
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";

export function createSourceState() {
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
  return { root, versions, current, lock, managerFile, installed, folder, atomicWrite, snapshot, cleanup };
}
