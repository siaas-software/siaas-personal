import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { generateCpu } from "./generator";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ffmpegPlan,
  videoInputs,
  mediaRequest,
  type MediaRequest,
} from "./plan";

const signature = Buffer.from("89504e470d0a1a0a", "hex");
export function checkPng(data: Buffer) {
  if (
    data.length < 45 ||
    data.length > 4 * 1024 * 1024 ||
    !data.subarray(0, 8).equals(signature)
  )
    throw new Error("Invalid PNG.");
  let offset = 8,
    width = 0,
    height = 0,
    pixels = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset),
      type = data.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + length > data.length) break;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) break;
      width = data.readUInt32BE(16);
      height = data.readUInt32BE(20);
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        width * height > 4194304
      )
        break;
    } else if (type === "IDAT") pixels = true;
    else if (
      type === "IEND" &&
      length === 0 &&
      offset + 12 === data.length &&
      pixels
    )
      return { width, height };
    else if (!["PLTE", "tRNS", "pHYs", "sRGB", "gAMA", "cHRM"].includes(type))
      break;
    offset += length + 12;
  }
  throw new Error("Unsupported PNG structure.");
}
const jobs = ((
  process as NodeJS.Process & { siaasMediaJobs?: Set<string> }
).siaasMediaJobs ??= new Set<string>());
export async function processFrames(
  profile: string,
  job: MediaRequest,
  videoInput: boolean,
  inputs: Buffer[],
  threads: number,
  signal: AbortSignal,
  revalidate: () => void,
) {
  mediaRequest.parse(job);
  if (
    !Number.isInteger(threads) ||
    threads < 1 ||
    threads > 4 ||
    inputs.length !== job.inputs.length ||
    jobs.has(profile)
  )
    throw new Error("Media worker unavailable.");
  if (!videoInput) inputs.forEach(checkPng);
  signal.throwIfAborted();
  jobs.add(profile);
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "siaas-frames-"));
    for (let i = 0; i < inputs.length; i++)
      await writeFile(
        join(directory, `frame-${i}.${videoInput ? "mp4" : "png"}`),
        inputs[i],
        {
          flag: "wx",
          mode: 0o600,
        },
      );
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(job.kind === "generate-image" ? 90000 : 30000),
    ]);
    if (job.kind === "generate-image") {
      const bytes = await generateCpu(
        profile,
        directory,
        job.prompt,
        job.seed,
        job.width,
        threads,
        deadline,
        revalidate,
      );
      const { width, height } = checkPng(bytes);
      const metadata = await inspectFile(
        join(directory, "result.png"),
        false,
        deadline,
      );
      if (
        width !== job.width ||
        height !== job.width ||
        metadata.codec !== "png"
      )
        throw new Error("Invalid generated image.");
      return { type: "file" as const, bytes, mime: "image/png" };
    }
    if (job.kind === "inspect") {
      revalidate();
      const metadata = await inspectFile(
        join(directory, videoInput ? "frame-0.mp4" : "frame-0.png"),
        videoInput,
        deadline,
      );
      revalidate();
      return { type: "metadata" as const, metadata };
    }
    const durations: number[] = [];
    if (videoInputs(job.kind)) {
      for (let i = 0; i < inputs.length; i++)
        durations.push(
          (await inspectFile(join(directory, `frame-${i}.mp4`), true, deadline))
            .frames,
        );
    }
    const { args, video, file, frames } = ffmpegPlan(job, threads, durations);
    revalidate();
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("/usr/bin/ffmpeg", args, {
        cwd: directory,
        env: { LANG: "C", NODE_ENV: "production" },
        stdio: "ignore",
        windowsHide: true,
        signal: deadline,
        killSignal: "SIGKILL",
      });
      let failed = false;
      proc.on("error", () => {
        failed = true;
      });
      proc.once("close", (code) =>
        code === 0 && !failed && !deadline.aborted
          ? resolve()
          : reject(new Error("Media processing failed or was cancelled.")),
      );
    });
    signal.throwIfAborted();
    const path = join(directory, file),
      size = (await stat(path)).size;
    if (!size || size >= 8388608)
      throw new Error("Media output exceeds quota.");
    const bytes = await readFile(path);
    const stream = await inspectFile(path, video, deadline);
    if (
      stream.width !== job.width ||
      stream.height !== job.height ||
      stream.codec !== (video ? "h264" : "png") ||
      (video && stream.frames !== frames)
    )
      throw new Error("Unexpected output format.");
    return {
      type: "file" as const,
      bytes,
      mime: video ? "video/mp4" : "image/png",
    };
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      jobs.delete(profile);
    }
  }
}

async function inspectFile(path: string, video: boolean, signal: AbortSignal) {
  const { stdout } = await promisify(execFile)(
    "/usr/bin/ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-f",
      video ? "mov" : "png_pipe",
      "-show_entries",
      "stream=width,height,codec_name,nb_frames",
      "-of",
      "json",
      path,
    ],
    {
      signal,
      killSignal: "SIGKILL",
      maxBuffer: 8192,
      env: { LANG: "C", NODE_ENV: "production" },
    },
  );
  const streams = JSON.parse(stdout).streams;
  if (!Array.isArray(streams) || streams.length !== 1)
    throw new Error("Unexpected output streams.");
  const [stream] = streams;
  if (
    (video &&
      (stream.codec_name !== "h264" ||
        !Number.isInteger(Number(stream.nb_frames)) ||
        Number(stream.nb_frames) < 1 ||
        Number(stream.nb_frames) > 288)) ||
    (!video && stream.codec_name !== "png") ||
    stream.width < 1 ||
    stream.width > 4096 ||
    stream.height < 1 ||
    stream.height > 4096
  )
    throw new Error("Unsupported media.");
  return {
    codec: stream.codec_name as string,
    width: stream.width as number,
    height: stream.height as number,
    frames: video ? Number(stream.nb_frames) : 1,
  };
}
