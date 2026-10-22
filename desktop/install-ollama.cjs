// Runs with the private Node runtime, never with renderer privileges.
const { createReadStream, createWriteStream } = require("node:fs");
const {
  mkdir,
  rm,
  rename,
  chmod,
  statfs,
  access,
} = require("node:fs/promises");
const { join, resolve, isAbsolute } = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createHash } = require("node:crypto");
const { createZstdDecompress } = require("node:zlib");
const extractZip = require("extract-zip");
const tar = require("tar");
const manifest = require("./ollama-assets.json");

function safeEntry(name) {
  const normalized = name.replaceAll("\\", "/");
  return (
    !isAbsolute(normalized) &&
    !/^[A-Za-z]:/.test(normalized) &&
    !normalized.split("/").includes("..")
  );
}
function assetFor(platform = process.platform, arch = process.arch) {
  const asset = manifest.platforms[`${platform}-${arch}`];
  if (!asset)
    throw new Error(
      "Installazione automatica non disponibile per questa architettura. Installa Ollama dal sito ufficiale.",
    );
  return asset;
}
async function downloadVerified(asset, destination, report = () => {}) {
  if (
    !/^https:\/\/github\.com\/ollama\/ollama\/releases\/download\//.test(
      asset.url,
    )
  )
    throw new Error("Origine download non valida.");
  const response = await fetch(asset.url, {
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!response.ok || !response.body)
    throw new Error(
      `Download non riuscito (${response.status}). Riprova quando la connessione è disponibile.`,
    );
  const hash = createHash("sha256");
  let bytes = 0,
    last = -1;
  const check = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > asset.bytes)
        return callback(new Error("Dimensione download non valida."));
      hash.update(chunk);
      const percent = Math.floor((bytes / asset.bytes) * 100);
      if (percent !== last) {
        last = percent;
        report({
          phase: "download",
          percent,
          message: `Download Ollama: ${percent}%`,
        });
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    check,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  if (bytes !== asset.bytes || hash.digest("hex") !== asset.sha256)
    throw new Error(
      "La verifica del download non è riuscita. Nessun programma è stato installato.",
    );
}
async function extractArchive(archive, destination, name) {
  if (name.endsWith(".zip")) {
    await extractZip(archive, {
      dir: resolve(destination),
      onEntry(entry) {
        if (!safeEntry(entry.fileName))
          throw new Error("Percorso non valido nel pacchetto.");
        // The official macOS app contains framework symlinks. extract-zip verifies
        // destination paths; the complete archive is pinned by SHA-256 before extraction.
      },
    });
  } else {
    await pipeline(
      createReadStream(archive),
      createZstdDecompress(),
      tar.x({
        cwd: destination,
        preservePaths: false,
        strict: true,
        filter(path, entry) {
          if (
            !safeEntry(path) ||
            (entry.linkpath && !safeEntry(entry.linkpath))
          )
            throw new Error("Percorso non valido nel pacchetto.");
          return true;
        },
      }),
    );
  }
}
async function install(directory, report = () => {}) {
  const asset = assetFor();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const final = join(directory, manifest.version);
  const binary = join(final, asset.binary);
  try {
    await access(binary);
    return binary;
  } catch {}
  const fs = await statfs(directory);
  if (fs.bavail * fs.bsize < asset.bytes * 4 + 1024 ** 3)
    throw new Error(
      "Spazio insufficiente per scaricare ed estrarre Ollama. Libera almeno 7 GB e riprova.",
    );
  const stage = join(directory, `${manifest.version}.partial`);
  const archive = join(directory, `${manifest.version}.download`);
  await rm(stage, { recursive: true, force: true });
  await rm(archive, { force: true });
  await mkdir(stage, { recursive: true });
  try {
    await downloadVerified(asset, archive, report);
    report({
      phase: "extract",
      message: "Download verificato. Installazione di Ollama…",
    });
    await extractArchive(archive, stage, asset.name);
    await access(join(stage, asset.binary));
    if (process.platform !== "win32")
      await chmod(join(stage, asset.binary), 0o755);
    // A failed attempt cannot replace a previously working installation.
    await rename(stage, final);
    report({
      phase: "complete",
      message: "Ollama installato. Avvio del servizio locale…",
    });
    return binary;
  } finally {
    await rm(archive, { force: true });
    await rm(stage, { recursive: true, force: true });
  }
}
module.exports = {
  safeEntry,
  assetFor,
  downloadVerified,
  extractArchive,
  install,
};
if (require.main === module) {
  const directory = process.argv[2];
  if (!directory) process.exit(2);
  install(resolve(directory), (event) =>
    process.stdout.write(JSON.stringify(event) + "\n"),
  ).catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });
}
