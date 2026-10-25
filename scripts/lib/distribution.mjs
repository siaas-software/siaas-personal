import { createHash } from "node:crypto";

export const REPOSITORY = "siaas-software/siaas-personal";
export const NODE_VERSION = "24.22.0";
export const stableVersion = (v) =>
  typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
export const releaseVersion = (v) => stableVersion(v) || (typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/.test(v));
export function compareVersions(a, b) {
  if (!releaseVersion(a) || !releaseVersion(b)) throw Error("Invalid release version");
  const [ac, ar] = a.split("-rc."), [bc, br] = b.split("-rc.");
  const x = ac.split(".").map(Number), y = bc.split(".").map(Number);
  for (let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]>y[i]?1:-1;
  if(ar===br) return 0;
  if(ar===undefined) return 1;
  if(br===undefined) return -1;
  return Number(ar)>Number(br)?1:-1;
}
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const failure = (message, status = 503) =>
  Object.assign(new Error(message), { status });
export function runtimeAsset(version, platform, arch) {
  if (
    !stableVersion(version) ||
    Number(version.split(".")[0]) < 24 ||
    !["win32", "darwin", "linux"].includes(platform) ||
    !["x64", "arm64"].includes(arch)
  )
    throw failure("Unsupported runtime or platform.", 400);
  const name = `node-v${version}-${platform === "win32" ? "win" : platform}-${arch}.${platform === "win32" ? "zip" : "tar.gz"}`;
  return { name, url: `https://nodejs.org/dist/v${version}/${name}` };
}
function sourceAsset(asset, version, suffix) {
  const name = `SIAAS-Personal-${version}-${suffix}`;
  const url = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
  if (
    asset?.name !== name ||
    asset.browser_download_url !== url ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > 500_000_000 ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest || "")
  )
    throw failure(
      `The public release has an invalid or missing ${suffix} asset or SHA-256 digest.`,
    );
  return {
    name,
    size: asset.size,
    sha256: asset.digest.slice(7),
    downloadUrl: url,
  };
}
async function checked(request, url) {
  const response = await request(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "SIAAS-Personal-Installer",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw failure(
      response.status === 404
        ? "No public stable SIAAS Personal release is available yet. The release repository and its installation assets must be publicly accessible. Please retry after publication."
        : `The download service is unavailable (HTTP ${response.status}). Please retry later.`,
      response.status === 404 ? 404 : 503,
    );
  return response;
}
async function bounded(response, limit) {
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) throw failure("Release metadata is too large.");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
export async function resolveManifest(platform, arch, request = fetch) {
  runtimeAsset(NODE_VERSION, platform, arch);
  const release = JSON.parse(
    (
      await bounded(
        await checked(
          request,
          `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
        ),
        200000,
      )
    ).toString(),
  );
  const version = release.tag_name?.replace(/^v/, "");
  if (
    !stableVersion(version) ||
    release.tag_name !== `v${version}` ||
    release.draft ||
    release.prerelease ||
    !Array.isArray(release.assets)
  )
    throw failure("No valid stable installation release is available.");
  const asset = (suffix) =>
    sourceAsset(
      release.assets.find(
        (a) => a.name === `SIAAS-Personal-${version}-${suffix}`,
      ),
      version,
      suffix,
    );
  const source = asset("source.zip");
  const specAsset = asset("install.json");
  const bytes = await bounded(
    await checked(request, specAsset.downloadUrl),
    10000,
  );
  if (
    bytes.length !== specAsset.size ||
    createHash("sha256").update(bytes).digest("hex") !== specAsset.sha256
  )
    throw failure(
      "The installation specification failed integrity verification.",
    );
  const spec = JSON.parse(bytes.toString());
  if (spec.schemaVersion !== 1 || spec.version !== version)
    throw failure("Invalid installation specification.");
  const runtime = runtimeAsset(spec.nodeVersion, platform, arch);
  const sums = (
    await bounded(
      await checked(
        request,
        `https://nodejs.org/dist/v${spec.nodeVersion}/SHASUMS256.txt`,
      ),
      100000,
    )
  ).toString();
  const sha256 = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === runtime.name)?.[0];
  if (!digest(sha256))
    throw failure("The official Node.js runtime checksum is unavailable.");
  return {
    schemaVersion: 1,
    version,
    platform,
    arch,
    ...source,
    runtime: { version: spec.nodeVersion, ...runtime, sha256 },
  };
}
export function validateManifest(
  m,
  platform = process.platform,
  arch = process.arch,
) {
  if (
    !m ||
    m.schemaVersion !== 1 ||
    !releaseVersion(m.version) ||
    m.platform !== platform ||
    m.arch !== arch
  )
    throw failure("Invalid installation manifest or incompatible platform.");
  sourceAsset(
    {
      name: m.name,
      size: m.size,
      digest: `sha256:${m.sha256}`,
      browser_download_url: m.downloadUrl,
    },
    m.version,
    "source.zip",
  );
  const r = runtimeAsset(m.runtime?.version, platform, arch);
  if (
    m.runtime.name !== r.name ||
    m.runtime.url !== r.url ||
    !digest(m.runtime.sha256)
  )
    throw failure("Invalid runtime manifest.");
  return m;
}
