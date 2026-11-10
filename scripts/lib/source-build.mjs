// Internal legacy preparation/build sequence; this is not a contained executor.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runtimeEnv, download, sha256 } from "./managed-runtime.mjs";
import { executable } from "./source-desktop.mjs";

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

export async function buildSource({ manifest, prepared, stage, source, runtime, emit }) {
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
}
