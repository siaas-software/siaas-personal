import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  rename,
  statfs,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromBufferPromise } from "yauzl";
import { freemem } from "node:os";
import { z } from "zod";
export const cpuComponents = {
  backend: {
    sha: "24fda39afa2e9299f0bfbc8b97b316d1d8f2f64dc928f315c147e50936e3c33e",
    size: 25457919,
  },
  model: {
    sha: "409ab23582ee074c6b9d5395784fc0741b0599fb9d138686c69087c71678eb6a",
    size: 682847200,
  },
} as const;
export const componentForm = z
  .object({
    component: z.enum(["backend", "model"]),
    path: z.string().min(1).max(4096),
  })
  .strict();
const location = (profile: string, k: keyof typeof cpuComponents) =>
  join(profile, "media-components", cpuComponents[k].sha);
export async function components(profile: string) {
  const has = async (k: keyof typeof cpuComponents) =>
    (await lstat(location(profile, k)).catch(() => null))?.size ===
    cpuComponents[k].size;
  return {
    platform: process.platform === "linux" && process.arch === "x64",
    backend: await has("backend"),
    model: await has("model"),
  };
}
async function hashCopy(
  source: string,
  dest: string,
  k: keyof typeof cpuComponents,
  signal: AbortSignal,
) {
  const { size, sha } = cpuComponents[k],
    hash = createHash("sha256");
  let count = 0;
  await pipeline(
    createReadStream(source),
    new Transform({
      transform(chunk, _, next) {
        count += chunk.length;
        if (count > size) return next(new Error("Component size mismatch."));
        hash.update(chunk);
        next(null, chunk);
      },
    }),
    createWriteStream(dest, { flags: "wx", mode: 0o400 }),
    { signal },
  );
  if (count !== size || hash.digest("hex") !== sha)
    throw new Error("Component checksum mismatch.");
}
const installing = ((
  process as NodeJS.Process & { siaasMediaInstall?: Set<string> }
).siaasMediaInstall ??= new Set<string>());
async function requireSpace(dir: string, bytes: number) {
  const fs = await statfs(dir);
  if (fs.bavail * fs.bsize < bytes + 64 * 1024 * 1024)
    throw new Error("Insufficient media staging space.");
}
export async function installComponent(
  profile: string,
  input: z.infer<typeof componentForm>,
  signal: AbortSignal,
) {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Unsupported CPU build.");
  const path = input.path;
  if (!isAbsolute(path) || (await realpath(path)) !== path)
    throw new Error("Select a local regular file.");
  const file = await lstat(path);
  if (!file.isFile() || file.size !== cpuComponents[input.component].size)
    throw new Error("Unexpected component.");
  const root = join(profile, "media-components");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (installing.has(profile))
    throw new Error("Component installation in progress.");
  installing.add(profile);
  let temp: string | undefined;
  try {
    await requireSpace(root, file.size);
    temp = await mkdtemp(join(root, "install-"));
    const staged = join(temp, "verified");
    await hashCopy(path, staged, input.component, signal);
    await rename(staged, location(profile, input.component));
  } finally {
    try {
      if (temp) await rm(temp, { recursive: true, force: true });
    } finally {
      installing.delete(profile);
    }
  }
}
export async function generateCpu(
  profile: string,
  dir: string,
  prompt: string,
  seed: number,
  width: number,
  threads: number,
  signal: AbortSignal,
  revalidate: () => void,
) {
  // Private staging and fixed pins also protect jobs resumed after local configuration edits.
  if (freemem() < 2 * 1024 ** 3)
    throw new Error("Insufficient available memory.");
  await requireSpace(dir, cpuComponents.model.size + 200 * 1024 * 1024);
  const binary = join(dir, "backend.zip");
  await hashCopy(location(profile, "backend"), binary, "backend", signal);
  const zip = await fromBufferPromise(await readFile(binary), {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  try {
    for await (const entry of zip.eachEntry()) {
      if (
        !/^(?:sd-cli|lib[A-Za-z0-9.-]+\.so(?:\.[0-9.]+)?)$/.test(entry.fileName)
      )
        continue;
      const dest = join(dir, entry.fileName);
      await pipeline(
        await zip.openReadStreamPromise(entry),
        createWriteStream(dest, {
          flags: "wx",
          mode: entry.fileName === "sd-cli" ? 0o500 : 0o400,
        }),
        { signal },
      );
    }
  } finally {
    zip.close();
  }
  const model = join(dir, "model.gguf");
  await hashCopy(location(profile, "model"), model, "model", signal);
  await writeFile(join(dir, "prompt.txt"), prompt, { flag: "wx", mode: 0o600 });
  revalidate();
  try {
    await promisify(execFile)(
      "/usr/bin/prlimit",
      [
        "--as=4831838208",
        "--cpu=100",
        "--fsize=8388608",
        "--",
        join(dir, "sd-cli"),
        "-m",
        model,
        "--prompt-file",
        "prompt.txt",
        "--steps",
        "1",
        "--cfg-scale",
        "1",
        "--backend",
        "cpu",
        "--params-backend",
        "cpu",
        "--auto-fit",
        "off",
        "--disable-image-metadata",
        "-t",
        String(threads),
        "-W",
        String(width),
        "-H",
        String(width),
        "--seed",
        String(seed),
        "-o",
        "result.png",
      ],
      {
        cwd: dir,
        env: { LANG: "C", NODE_ENV: "production", HOME: dir },
        signal,
        killSignal: "SIGKILL",
        maxBuffer: 65536,
      },
    );
  } catch {
    throw new Error("CPU image generation failed or was cancelled.");
  }
  const size = (await stat(join(dir, "result.png"))).size;
  if (!size || size > 4 * 1024 * 1024)
    throw new Error("Unexpected generated file.");
  return readFile(join(dir, "result.png"));
}
