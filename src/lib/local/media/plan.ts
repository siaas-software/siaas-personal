import { z } from "zod";
const dimension = z.number().int().min(16).max(1280).multipleOf(2);
const counts = {
  resize: [1, 1],
  overlay: [2, 2],
  compose: [2, 2],
  "photos-to-video": [1, 12],
  transition: [2, 2],
  transcode: [1, 1],
  "join-videos": [2, 2],
} as const;
export const mediaJob = z
  .object({
    kind: z.enum([
      "resize",
      "overlay",
      "compose",
      "photos-to-video",
      "transition",
      "transcode",
      "join-videos",
    ]),
    inputs: z.array(z.string().uuid()).min(1).max(12),
    width: dimension,
    height: dimension,
  })
  .strict()
  .refine((job) => {
    const [min, max] = counts[job.kind];
    return job.inputs.length >= min && job.inputs.length <= max;
  });
export const mediaRequest = z.union([
  mediaJob,
  z
    .object({
      kind: z.literal("inspect"),
      inputs: z.tuple([z.string().uuid()]),
    })
    .strict(),
]);
export type MediaRequest = z.infer<typeof mediaRequest>;
export type MediaJob = z.infer<typeof mediaJob>;
export const videoInputs = (kind: MediaJob["kind"]) =>
  kind === "transcode" || kind === "join-videos";
export function ffmpegPlan(
  job: MediaJob,
  threads: number,
  durations: number[],
) {
  const { width: w, height: h, kind } = job;
  const fit = (width: number, height: number) =>
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const video =
    videoInputs(kind) || kind === "photos-to-video" || kind === "transition";
  const frames = videoInputs(kind)
    ? durations.reduce((a, b) => a + b, 0)
    : kind === "transition"
      ? 18
      : job.inputs.length * 12;
  if (video && (!Number.isInteger(frames) || frames <= 0 || frames > 288))
    throw new Error("Unsupported video duration.");
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
    "-filter_complex_threads",
    String(threads),
  ];
  const inputOptions = [
    "-protocol_whitelist",
    "file",
    "-threads",
    String(threads),
  ];
  if (kind === "photos-to-video")
    args.push(
      ...inputOptions,
      "-f",
      "image2",
      "-framerate",
      "1",
      "-c:v",
      "png",
      "-i",
      "frame-%d.png",
    );
  else
    job.inputs.forEach((_, i) => {
      args.push(...inputOptions);
      if (videoInputs(kind))
        args.push("-f", "mov", "-c:v", "h264", "-i", `frame-${i}.mp4`);
      else
        args.push(
          "-f",
          "image2",
          ...(kind === "transition" ? ["-loop", "1", "-framerate", "12"] : []),
          "-c:v",
          "png",
          "-i",
          `frame-${i}.png`,
        );
    });
  let graph: string | undefined;
  if (kind === "compose")
    graph = `[0:v]${fit(w / 2, h)}[a];[1:v]${fit(w / 2, h)}[b];[a][b]hstack`;
  if (kind === "overlay")
    graph = `[0:v]${fit(w, h)}[a];[1:v]${fit(2 * Math.floor(w / 6), 2 * Math.floor(h / 6))}[b];[a][b]overlay=W-w:H-h`;
  if (kind === "transition" || kind === "join-videos") {
    const step = `${fit(w, h)},format=yuv444p,setpts=PTS-STARTPTS,fps=12`;
    const combine =
      kind === "transition"
        ? "xfade=transition=fade:duration=0.5:offset=0.5"
        : "concat=n=2:v=1:a=0";
    graph = `[0:v]${step}[a];[1:v]${step}[b];[a][b]${combine}`;
  }
  args.push(
    ...(graph
      ? ["-filter_complex", graph + "[rendered]", "-map", "[rendered]"]
      : ["-vf", fit(w, h)]),
    "-an",
    "-sn",
    "-map_metadata",
    "-1",
    "-threads",
    String(threads),
  );
  const file = video ? "result.mp4" : "result.png";
  args.push(
    ...(video
      ? [
          "-r",
          "12",
          "-frames:v",
          String(frames),
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
  );
  return { args, video, file, frames };
}
