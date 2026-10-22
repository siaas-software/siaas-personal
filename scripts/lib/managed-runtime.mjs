import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, dirname, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { runtimeAsset } from "./distribution.mjs";

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
export async function download(url, path, digest, size) {
  let response;
  for (let n = 0; n <= 5; n++) {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "nodejs.org",
      ].includes(u.hostname)
    )
      throw Error("Untrusted download destination.");
    response = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(180000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get("location"), u).href;
      await response.body?.cancel();
      continue;
    }
    break;
  }
  if (!response?.ok)
    throw Error(
      `Download failed (HTTP ${response?.status}). Check the network and retry.`,
    );
  const file = createWriteStream(path, { flags: "wx", mode: 0o600 });
  let count = 0;
  const hash = createHash("sha256");
  try {
    // Wait for open/errors before streaming; pipeline ensures backpressure and error propagation.
    const { pipeline } = await import("node:stream/promises");
    async function* checked() {
      for await (const bytes of response.body) {
        count += bytes.length;
        if (count > (size || 150_000_000))
          throw Error("Download exceeds its expected size.");
        hash.update(bytes);
        yield bytes;
      }
    }
    await pipeline(checked(), file);
    if ((size && count !== size) || hash.digest("hex") !== digest)
      throw Error("Download integrity verification failed. Please retry.");
  } catch (error) {
    file.destroy();
    await rm(path, { force: true });
    throw error;
  }
}
export function runtimeEnv(node, source = process.env) {
  const env = { ...source };
  const path = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  const oldPath = path ? env[path] : "";
  for (const key of Object.keys(env))
    if (
      [
        "PATH",
        "NODE_OPTIONS",
        "NODE_PATH",
        "NPM_CONFIG_PREFIX",
        "NPM_CONFIG_GLOBAL",
        "NPM_CONFIG_NODE_OPTIONS",
      ].includes(key.toUpperCase())
    )
      delete env[key];
  env.PATH = dirname(node) + delimiter + (oldPath || "");
  env.SIAAS_SOURCE_NODE = node;
  return env;
}
export function runtimePaths(root, version) {
  runtimeAsset(version, process.platform, process.arch);
  const folder = join(
    root,
    "runtimes",
    `node-v${version}-${process.platform}-${process.arch}`,
  );
  return {
    folder,
    node: join(folder, process.platform === "win32" ? "node.exe" : "bin/node"),
    npm: join(
      folder,
      process.platform === "win32"
        ? "node_modules/npm/bin/npm-cli.js"
        : "lib/node_modules/npm/bin/npm-cli.js",
    ),
  };
}
export async function verifyRuntime(runtime, version) {
  if (
    !runtime ||
    runtime.version !== version ||
    !existsSync(runtime.node) ||
    !existsSync(runtime.npm) ||
    !/^[a-f0-9]{64}$/.test(runtime.binarySha256 || "") ||
    (await sha256(runtime.node)) !== runtime.binarySha256
  )
    throw Error(
      "The application-managed Node.js runtime is missing or corrupted. Close SIAAS Personal and rerun the official installer to repair it.",
    );
  const check = spawnSync(runtime.node, ["--version"], {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    env: runtimeEnv(runtime.node),
  });
  if (
    check.error ||
    check.status !== 0 ||
    check.stdout.trim() !== `v${version}`
  )
    throw Error(
      "The application-managed Node.js runtime is incompatible with this computer.",
    );
  return runtime;
}
export async function provisionRuntime(root, spec) {
  const paths = runtimePaths(root, spec.version);
  if (existsSync(paths.folder)) {
    try {
      return await verifyRuntime(
        JSON.parse(await readFile(join(paths.folder, "runtime.json"), "utf8")),
        spec.version,
      );
    } catch {
      throw Error(
        `The managed runtime requires repair. Close SIAAS Personal, rename ${paths.folder}, then rerun the installer. Existing application data is preserved.`,
      );
    }
  }
  await mkdir(join(root, "runtimes"), { recursive: true });
  const stage = await mkdtemp(join(root, "runtimes", ".stage-"));
  try {
    const archive = join(stage, spec.name);
    await download(spec.url, archive, spec.sha256);
    const tar =
      process.platform === "win32"
        ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
        : "tar";
    const args =
      process.platform === "win32"
        ? ["-xf", archive, "-C", stage]
        : ["--no-same-owner", "-xzf", archive, "-C", stage];
    const result = spawnSync(tar, args, { stdio: "inherit", shell: false });
    if (result.error || result.status !== 0)
      throw Error(
        "Unable to extract the managed runtime. Install the operating system archive tools and retry.",
      );
    const extracted = join(stage, spec.name.replace(/\.(zip|tar\.gz)$/, ""));
    await rename(extracted, paths.folder);
    const runtime = {
      ...paths,
      version: spec.version,
      binarySha256: await sha256(paths.node),
    };
    await writeFile(
      join(paths.folder, "runtime.json"),
      JSON.stringify(runtime, null, 2),
    );
    return await verifyRuntime(runtime, spec.version);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
