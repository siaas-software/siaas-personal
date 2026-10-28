// Verify local source-distribution artifacts, optionally downloading the published
// prerelease anonymously. No mutation of GitHub or installation is performed.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { validateManifest, stableVersion } from "./lib/distribution.mjs";
const directory =
  process.argv.find((a) => a.startsWith("--directory="))?.slice(12) ||
  "dist-source";
const published = process.argv.includes("--published");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
assert(
  /^\d+\.\d+\.\d+-rc\.\d+$/.test(version),
  "This verifier requires an RC version",
);
const repository = "siaas-software/siaas-personal";
const tag = `v${version}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const names = [
  `SIAAS-Personal-${version}-source.zip`,
  `SIAAS-Personal-${version}-install.json`,
  "install-siaas.ps1",
  "install-siaas.sh",
  "rc-manifests.json",
  "rc-manifests.tsv",
  "install-rc.ps1",
  "install-rc.sh",
  "RELEASE_NOTES.md",
  "READINESS.md",
  "WINDOWS_TESTING.md",
];
const expected = [...names, "SHA256SUMS.txt"].sort();
assert.deepEqual(
  (await readdir(directory)).sort(),
  expected,
  "Missing or unexpected release payloads",
);
const bytes = Object.fromEntries(
  await Promise.all(
    expected.map(async (name) => [name, await readFile(join(directory, name))]),
  ),
);
const checksumLines = bytes["SHA256SUMS.txt"].toString().trim().split(/\r?\n/);
const checksums = new Map();
for (const line of checksumLines) {
  const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
  assert(
    match && !checksums.has(match[2]),
    "Malformed/duplicate checksum entry",
  );
  checksums.set(match[2], match[1]);
}
assert.deepEqual([...checksums.keys()].sort(), names.sort());
for (const name of names)
  assert.equal(
    hash(bytes[name]),
    checksums.get(name),
    `Checksum mismatch: ${name}`,
  );
assert.equal(
  hash(bytes[`SIAAS-Personal-${version}-source.zip`]),
  hash(
    execFileSync("git", ["archive", "--format=zip", "HEAD"], {
      maxBuffer: 500_000_000,
    }),
  ),
  "Archive differs from release commit",
);
assert.equal(
  JSON.parse(
    execFileSync("git", ["show", "HEAD:package.json"], { encoding: "utf8" }),
  ).version,
  version,
);
const lock = JSON.parse(
  execFileSync("git", ["show", "HEAD:package-lock.json"], {
    encoding: "utf8",
    maxBuffer: 5_000_000,
  }),
);
assert.equal(lock.version, version);
assert.equal(lock.packages[""].version, version);
const runtime = JSON.parse(await readFile("runtime.json", "utf8"));
assert.deepEqual(JSON.parse(bytes[`SIAAS-Personal-${version}-install.json`]), {
  schemaVersion: 1,
  version,
  nodeVersion: runtime.nodeVersion,
});
async function download(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SIAAS-Personal-RC-Verification",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(120000),
  });
  assert(response.ok, `${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const officialSums = new Map(
  (
    await download(
      `https://nodejs.org/dist/v${runtime.nodeVersion}/SHASUMS256.txt`,
    )
  )
    .toString()
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [sha, name] = line.trim().split(/\s+/);
      return [name, sha];
    }),
);
const manifests = JSON.parse(bytes["rc-manifests.json"]),
  lines = [];
const targets = ["win32", "darwin", "linux"].flatMap((platform) =>
  ["x64", "arm64"].map((arch) => `${platform}-${arch}`),
);
assert.deepEqual(Object.keys(manifests).sort(), [...targets].sort());
for (const target of targets) {
  const [platform, arch] = target.split("-"),
    m = validateManifest(manifests[target], platform, arch);
  assert.equal(m.version, version);
  assert.equal(m.size, bytes[m.name].length);
  assert.equal(m.sha256, hash(bytes[m.name]));
  assert.equal(m.runtime.version, runtime.nodeVersion);
  assert.equal(m.runtime.sha256, officialSums.get(m.runtime.name));
  lines.push(
    [
      platform,
      arch,
      m.version,
      m.name,
      m.size,
      m.sha256,
      m.downloadUrl,
      m.runtime.version,
      m.runtime.name,
      m.runtime.sha256,
      m.runtime.url,
    ].join("\t"),
  );
}
assert.equal(bytes["rc-manifests.tsv"].toString(), lines.join("\n") + "\n");
for (const [source, destination] of [
  ["scripts/install.ps1", "install-siaas.ps1"],
  ["scripts/install.sh", "install-siaas.sh"],
  ["scripts/install-rc.ps1", "install-rc.ps1"],
  ["scripts/install-rc.sh", "install-rc.sh"],
])
  assert.deepEqual(bytes[destination], await readFile(source));
if (published) {
  const release = JSON.parse(
    await download(
      `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    ),
  );
  const tagRef = JSON.parse(
    await download(
      `https://api.github.com/repos/${repository}/git/ref/tags/${tag}`,
    ),
  );
  let target = tagRef.object;
  for (let depth = 0; target.type === "tag" && depth < 4; depth++)
    target = JSON.parse(
      await download(
        `https://api.github.com/repos/${repository}/git/tags/${target.sha}`,
      ),
    ).object;
  assert.equal(target.type, "commit");
  assert.equal(
    target.sha,
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    "Published tag differs from verified source commit",
  );
  assert.equal(release.tag_name, tag);
  assert.equal(release.prerelease, true);
  assert.equal(release.draft, false);
  assert.deepEqual(release.assets.map((a) => a.name).sort(), expected);
  for (const asset of release.assets) {
    assert.equal(
      asset.browser_download_url,
      `https://github.com/${repository}/releases/download/${tag}/${asset.name}`,
    );
    const remote = await download(asset.browser_download_url);
    assert.equal(remote.length, asset.size);
    assert.equal(asset.digest, `sha256:${hash(remote)}`);
    assert.deepEqual(
      remote,
      bytes[asset.name],
      `Published bytes differ: ${asset.name}`,
    );
    console.log(
      `PASS anonymous download: ${asset.name} ${remote.length} bytes sha256:${hash(remote)}`,
    );
  }
  const latest = JSON.parse(
    await download(
      `https://api.github.com/repos/${repository}/releases/latest`,
    ),
  );
  assert(
    stableVersion(latest.tag_name?.slice(1)) &&
      !latest.prerelease &&
      !latest.draft &&
      latest.tag_name !== tag,
    "Stable Latest was changed to an RC",
  );
  console.log(
    `PASS public prerelease ${release.html_url}; stable Latest ${latest.tag_name}`,
  );
}
console.log(
  `PASS ${tag}: 12 payloads, SHA-256, source commit/version, six platform manifests and official runtime hashes; ${published ? "published bytes verified anonymously" : "local artifacts only"}.`,
);
