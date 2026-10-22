import { isDesktop } from "@/lib/runtime";
import {
  githubRelease,
  manifestName,
  readManifest,
  releaseAsset,
  signedAssetLocation,
  targetSchema,
} from "@/lib/desktop-releases";
export const dynamic = "force-dynamic";

// Public installer metadata is independent of the local workspace.
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  if (isDesktop()) return Response.json({}, { status: 404, headers });
  const url = new URL(request.url);
  const target = targetSchema.safeParse({
    platform: url.searchParams.get("platform"),
    arch: url.searchParams.get("arch"),
  });
  const tag = url.searchParams.get("tag");
  if (!target.success || (tag && !/^v\d+\.\d+\.\d+$/.test(tag)))
    return Response.json(
      { error: "Unsupported platform or version." },
      { status: 400, headers },
    );
  try {
    const release = await githubRelease(tag || undefined);
    const asset = release.assets.find(
      (a) => a.name === manifestName(target.data),
    );
    if (!asset)
      return Response.json(
        { error: "No installer available for this platform." },
        { status: 404, headers },
      );
    const manifest = await readManifest(asset, {
      ...target.data,
      tag: release.tag_name,
    });
    const extension = { win32: ".exe", darwin: ".dmg", linux: ".AppImage" }[
      target.data.platform
    ];
    const file = manifest.files.find((f) => f.url.endsWith(extension));
    const binary = release.assets.find((a) => a.name === file?.url);
    if (!file || !binary || binary.size !== file.size)
      throw new Error("Invalid installer");
    if (url.searchParams.get("download") === "1")
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          Location: signedAssetLocation(await releaseAsset(binary.id)),
        },
      });
    url.searchParams.set("tag", release.tag_name);
    url.searchParams.set("download", "1");
    return Response.json(
      {
        version: manifest.version,
        name: file.url,
        size: file.size,
        sha512: Buffer.from(file.sha512, "base64").toString("hex"),
        downloadUrl: url.href,
      },
      { headers },
    );
  } catch (error) {
    const absent = (error as Error).message === "No release";
    return Response.json(
      {
        error: absent
          ? "No stable installer has been published yet."
          : "Installer service temporarily unavailable.",
      },
      { status: absent ? 404 : 503, headers },
    );
  }
}
