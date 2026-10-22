import { z } from "zod";

export const targetSchema = z
  .object({
    platform: z.enum(["win32", "darwin", "linux"]),
    arch: z.enum(["x64", "arm64"]),
  })
  .refine((t) => t.arch === "x64" || t.platform === "darwin");
const version = /^\d+\.\d+\.\d+$/;
export type ReleaseTarget = { tag: string; platform: "win32" | "darwin" | "linux"; arch: "x64" | "arm64" };
export function manifestName(t: Pick<ReleaseTarget, "platform" | "arch">) {
  return `update-${t.platform}-${t.arch}.json`;
}
export function validateManifest(input: unknown, target: ReleaseTarget) {
  const m = z
    .object({
      version: z.string().regex(version),
      files: z
        .array(
          z.object({
            url: z.string(),
            sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
            size: z.number().int().positive(),
          }),
        )
        .min(1)
        .max(4),
      releaseDate: z.string(),
    })
    .parse(input);
  if (`v${m.version}` !== target.tag)
    throw new Error("Manifest version mismatch");
  const os = { win32: "win", darwin: "mac", linux: "linux" }[target.platform];
  const allowed =
    target.platform === "win32"
      ? ["exe"]
      : target.platform === "darwin"
        ? ["zip", "dmg"]
        : ["AppImage"];
  const artifactArch =
    target.platform === "linux" && target.arch === "x64"
      ? "x86_64"
      : target.arch;
  for (const f of m.files) {
    if (
      !allowed.some(
        (ext) => f.url === `SIAAS-Personal-${m.version}-${os}-${artifactArch}.${ext}`,
      )
    )
      throw new Error("Unexpected release asset");
  }
  return { ...m, path: m.files[0].url, sha512: m.files[0].sha512 };
}
export type Release = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body: string;
  assets: { id: number; name: string; size: number }[];
};
export async function githubRelease(tag?: string): Promise<Release> {
  const repo = process.env.SIAAS_RELEASE_REPOSITORY || "siaas-software/siaas-personal";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("Invalid release repository");
  const result = await fetch(
    `https://api.github.com/repos/${repo}/releases/${tag ? "tags/" + encodeURIComponent(tag) : "latest"}`,
    {
      headers: githubHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    },
  );
  if (result.status === 404) throw new Error("No release");
  if (!result.ok) throw new Error("Release service unavailable");
  const release = (await result.json()) as Release;
  if (
    release.draft ||
    release.prerelease ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name)
  )
    throw new Error("No release");
  return release;
}
function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
export async function releaseAsset(id: number) {
  const repo = process.env.SIAAS_RELEASE_REPOSITORY || "siaas-software/siaas-personal";
  return fetch(`https://api.github.com/repos/${repo}/releases/assets/${id}`, {
    headers: { ...githubHeaders(), Accept: "application/octet-stream" },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
}
export function signedAssetLocation(response: Response) {
  const url = new URL(response.headers.get("location") || "invalid:");
  if (
    response.status !== 302 ||
    url.protocol !== "https:" ||
    url.hostname !== "release-assets.githubusercontent.com" ||
    url.username ||
    url.password
  )
    throw new Error("Invalid asset redirect");
  return url.href;
}
export async function readManifest(
  asset: { id: number; size: number },
  target: ReleaseTarget,
) {
  if (asset.size > 65536) throw new Error("Manifest too large");
  let r = await releaseAsset(asset.id);
  if (r.status === 302)
    r = await fetch(signedAssetLocation(r), {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  if (!r.ok || !r.body) throw new Error("Manifest unavailable");
  const reader = r.body.getReader();
  let text = "",
    size = 0;
  try {
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw new Error("Manifest too large");
      parts.push(value);
    }
    text = Buffer.concat(parts).toString();
  } finally {
    await reader.cancel();
  }
  return validateManifest(JSON.parse(text), target);
}
