import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const dimension = z.number().int().min(16).max(1280).multipleOf(2);
export const mediaJob = z
  .object({
    kind: z.enum(["resize", "photos-to-video"]),
    inputs: z.array(z.string().uuid()).min(1).max(12),
    width: dimension,
    height: dimension,
  })
  .strict()
  .refine((j) => j.kind !== "resize" || j.inputs.length === 1);
export type MediaJob = z.infer<typeof mediaJob>;
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
  job: MediaJob,
  inputs: Buffer[],
  threads: number,
  signal: AbortSignal,
  revalidate: () => void,
) {
  mediaJob.parse(job);
  if (
    !Number.isInteger(threads) ||
    threads < 1 ||
    threads > 4 ||
    inputs.length !== job.inputs.length ||
    jobs.has(profile)
  )
    throw new Error("Media worker unavailable.");
  inputs.forEach(checkPng);
  signal.throwIfAborted();
  jobs.add(profile);
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "siaas-frames-"));
    for (let i = 0; i < inputs.length; i++)
      await writeFile(join(directory, `frame-${i}.png`), inputs[i], {
        flag: "wx",
        mode: 0o600,
      });
    const video = job.kind === "photos-to-video",
      file = video ? "result.mp4" : "result.png";
    const filter = `scale=${job.width}:${job.height}:force_original_aspect_ratio=decrease,pad=${job.width}:${job.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    // Fixed local executable, demuxer, filename pattern and encoder. Each photo lasts one second.
    const args = [
      "-nostdin",
      "-n",
      "-v",
      "error",
      "-xerror",
      "-max_alloc",
      "67108864",
      "-filter_threads",
      String(threads),
      "-protocol_whitelist",
      "file",
      "-threads",
      String(threads),
      "-f",
      "image2",
      "-framerate",
      "1",
      "-c:v",
      "png",
      "-i",
      "frame-%d.png",
      "-an",
      "-sn",
      "-map_metadata",
      "-1",
      "-vf",
      filter,
      "-threads",
      String(threads),
      ...(video
        ? [
            "-r",
            "12",
            "-t",
            String(inputs.length),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-movflags",
            "+faststart",
          ]
        : ["-frames:v", "1", "-c:v", "png"]),
      "-fs",
      "8388608",
      file,
    ];
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
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
        cwd: directory,
        signal: deadline,
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
      stream.width !== job.width ||
      stream.height !== job.height ||
      stream.codec_name !== (video ? "h264" : "png") ||
      (video && Number(stream.nb_frames) !== inputs.length * 12)
    )
      throw new Error("Unexpected output format.");
    return { bytes, mime: video ? "video/mp4" : "image/png" };
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      jobs.delete(profile);
    }
  }
}
