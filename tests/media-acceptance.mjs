import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export async function checkMedia({
  api,
  origin,
  headers,
  assistant,
  stranger,
  project,
  direct,
  complete,
  until,
}) {
  const media = "/api/assistants/" + assistant.id + "/media";
  const strangerMedia = "/api/assistants/" + stranger.id + "/media";
  const approvals = "/api/projects/" + project.id + "/approvals";
  const source = (color) =>
    execFileSync("/usr/bin/ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=" + color + ":s=40x32",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-c:v",
      "png",
      "-f",
      "image2pipe",
      "pipe:1",
    ]).toString("base64");
  const red = source("red"),
    blue = source("blue");
  assert.equal((await api("/api/local/media")).enabled, false);
  await api(media, "POST", { png: red }, 403);
  await api("/api/local/media", "PUT", { enabled: true, threads: 1 });
  await api(media, "POST", { png: "AAAA" }, 400);
  const a = (await api(media, "POST", { png: red }, 201)).id,
    b = (await api(media, "POST", { png: blue }, 201)).id;
  const foreign = (await api(strangerMedia, "POST", { png: blue }, 201)).id;
  const ask = (kind, inputs) =>
    direct(
      assistant,
      "/media " + JSON.stringify({ kind, inputs, width: 64, height: 64 }),
    );
  assert.equal((await ask("resize", [foreign])).status, "error");
  for (const [kind, inputs] of [
    ["resize", [a]],
    ["photos-to-video", [a, b]],
  ]) {
    const run = ask(kind, inputs);
    const pending = await until(async () => (await api(approvals)).pending[0]);
    assert.deepEqual(JSON.parse(pending.parameters).inputs, inputs);
    await api(approvals, "POST", { id: pending.id, outcome: "approved" });
    const result = await run;
    assert.equal(result.status, "complete", result.content);
    const url = result.content.match(/\((\/api\/[^)]+)\)/)?.[1];
    assert(url);
    const output = await fetch(origin + url, { headers });
    assert.equal(output.status, 200);
    const data = Buffer.from(await output.arrayBuffer());
    const inspected = JSON.parse(
      execFileSync(
        "/usr/bin/ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", "pipe:0"],
        { input: data },
      ),
    ).streams[0];
    assert.equal(inspected.width, 64);
    assert.equal(inspected.height, 64);
    assert.equal(inspected.codec_name, kind === "resize" ? "png" : "h264");
    if (kind !== "resize") assert.equal(Number(inspected.nb_frames), 24);
    const raw = execFileSync(
      "/usr/bin/ffmpeg",
      [
        "-v",
        "error",
        "-i",
        "pipe:0",
        "-vf",
        "crop=2:2:32:32",
        "-threads",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      { input: data },
    );
    assert(raw[0] > 220 && raw[2] < 25);
    if (kind !== "resize") assert(raw.at(-1) > 220 && raw.at(-3) < 25);
    await api(
      strangerMedia + new URL(origin + url).search,
      "GET",
      undefined,
      404,
    );
  }
  const initialVideo = (await api(media)).find(
    (f) => f.mime === "video/mp4",
  ).id;
  for (const [kind, inputs, codec, frames] of [
    ["overlay", [a, b], "png", 1],
    ["compose", [a, b], "png", 1],
    ["transition", [a, b], "h264", 18],
    ["transcode", [initialVideo], "h264", 24],
    ["join-videos", [initialVideo, initialVideo], "h264", 48],
  ]) {
    const run = complete(
      "/media " + JSON.stringify({ kind, inputs, width: 64, height: 64 }),
      kind === "overlay" ? "builtin:media" : undefined,
    );
    const approval = await until(async () => (await api(approvals)).pending[0]);
    await api(approvals, "POST", { id: approval.id, outcome: "approved" });
    const result = await run;
    assert.equal(result.status, "complete", kind + " " + result.content);
    const url = result.steps[0].text.match(/\((\/api\/[^)]+)\)/)[1];
    const response = await fetch(origin + url, { headers });
    const bytes = Buffer.from(await response.arrayBuffer());
    const probe = JSON.parse(
      execFileSync(
        "/usr/bin/ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-of",
          "json",
          "pipe:0",
        ],
        { input: bytes },
      ),
    ).streams[0];
    assert.equal(probe.codec_name, codec);
    assert.equal(Number(probe.nb_read_frames), frames);
    assert.equal(probe.width, 64);
    assert.equal(probe.height, 64);
    console.log(
      "PASS desktop FFmpeg " + kind + " " + codec + " frames=" + frames,
    );
  }
  const inspection = direct(
    assistant,
    "/media " + JSON.stringify({ kind: "inspect", inputs: [initialVideo] }),
  );
  const consent = await until(async () => (await api(approvals)).pending[0]);
  await api(approvals, "POST", { id: consent.id, outcome: "approved" });
  assert.deepEqual(JSON.parse((await inspection).content), {
    codec: "h264",
    width: 64,
    height: 64,
    frames: 24,
  });
  if (process.argv.includes("--generate-image")) {
    for (const [component, path] of [
      ["backend", process.env.SIAAS_TEST_SD_ZIP],
      ["model", process.env.SIAAS_TEST_SD_MODEL],
    ]) {
      assert(path, "Pinned CPU component required");
      await api("/api/local/media", "POST", { component, path });
    }
    await api("/api/local/media", "PUT", {
      enabled: true,
      generation: true,
      threads: 2,
    });
    const prompt = "A red ceramic cup on a white table";
    const generation = direct(
      assistant,
      "/media " +
        JSON.stringify({
          kind: "generate-image",
          prompt,
          width: 256,
          seed: 41,
        }),
    );
    const request = await until(async () => (await api(approvals)).pending[0]);
    assert.equal(request.operation, "media_generate");
    await api(approvals, "POST", { id: request.id, outcome: "approved" });
    const result = await generation;
    assert.equal(result.status, "complete", result.content);
    const url = result.content.match(/\((\/api\/[^)]+)\)/)[1];
    const bytes = Buffer.from(
      await (await fetch(origin + url, { headers })).arrayBuffer(),
    );
    assert(!bytes.includes(Buffer.from(prompt)));
    const rgb = execFileSync(
      "/usr/bin/ffmpeg",
      [
        "-v",
        "error",
        "-i",
        "pipe:0",
        "-threads",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { input: bytes },
    );
    assert.equal(rgb.length, 256 * 256 * 3);
    assert(new Set(rgb).size > 64);
    console.log(
      "PASS approved desktop generation with pinned SDXS and stable-diffusion.cpp CPU, decoded 256×256 PNG.",
    );
  }
  const waiting = ask("resize", [a]);
  await until(async () => (await api(approvals)).pending[0]);
  await api("/api/local/media", "PUT", { enabled: false, threads: 1 });
  const changed = (await api(approvals)).pending[0];
  if (changed)
    await fetch(origin + approvals, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: changed.id, outcome: "approved" }),
    });
  assert.equal((await waiting).status, "error");
  console.log(
    "PASS real desktop PNG resize and two-photo H.264 assembly, verified dimensions, frame order, user approval, scope and disabled settings.",
  );
}
