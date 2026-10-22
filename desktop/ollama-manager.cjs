const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { existsSync, mkdirSync, openSync, closeSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");
const { connect } = require("node:net");
const manifest = require("./ollama-assets.json");
const run = promisify(execFile);
function versionCompatible(version) {
  const values = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(version || "");
  if (!values) return false;
  const target = manifest.minimumVersion.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const current = Number(values[i + 1]);
    if (current !== target[i]) return current > target[i];
  }
  return true;
}
function localURL(
  raw = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
) {
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Ollama deve usare un indirizzo HTTP locale.");
  return url.origin;
}
async function probe(base) {
  try {
    const r = await fetch(base + "/api/version", {
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data.version === "string"
      ? { version: data.version, compatible: versionCompatible(data.version) }
      : null;
  } catch {
    return null;
  }
}
async function occupied(base) {
  const url = new URL(base);
  return new Promise((resolve) => {
    const socket = connect({
      host: url.hostname.replace(/[\[\]]/g, ""),
      port: Number(url.port || 80),
    });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(true));
  });
}
function managedBinary(directory) {
  const asset = manifest.platforms[`${process.platform}-${process.arch}`];
  return asset ? join(directory, manifest.version, asset.binary) : null;
}
async function installedBinary(directory) {
  const candidates = [];
  try {
    const { stdout } = await run(
      process.platform === "win32" ? "where.exe" : "/usr/bin/which",
      ["ollama"],
      { timeout: 2500, windowsHide: true },
    );
    candidates.push(...stdout.trim().split(/\r?\n/));
  } catch {}
  if (process.platform === "win32") {
    if (process.env.LOCALAPPDATA)
      candidates.push(
        join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"),
      );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Ollama.app/Contents/Resources/ollama",
      join(homedir(), "Applications/Ollama.app/Contents/Resources/ollama"),
      "/opt/homebrew/bin/ollama",
      "/usr/local/bin/ollama",
    );
  } else candidates.push("/usr/local/bin/ollama", "/usr/bin/ollama");
  const privateBinary = managedBinary(directory);
  if (privateBinary) candidates.push(privateBinary);
  for (const binary of [...new Set(candidates)]) {
    if (!existsSync(binary)) continue;
    try {
      const r = await run(binary, ["--version"], {
        timeout: 8000,
        windowsHide: true,
      });
      const version =
        /(?:version is|version)\s+v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i.exec(
          r.stdout + r.stderr,
        )?.[1];
      // An existing incompatible installation is reported, never overwritten.
      return {
        binary,
        compatible: versionCompatible(version),
        version: version || "sconosciuta",
      };
    } catch {
      return { binary, compatible: false, version: "non verificabile" };
    }
  }
  return null;
}
class OllamaManager {
  constructor({ directory, node, helper, report = () => {} }) {
    Object.assign(this, { directory, node, helper, report });
    this.base = localURL();
    this.child = null;
    this.installer = null;
    this.busy = false;
  }
  async ensure() {
    const service = await probe(this.base);
    if (service) {
      if (!service.compatible)
        throw new Error(
          `Ollama ${service.version} è già attivo. Aggiornalo dal suo installer (richiesto ${manifest.minimumVersion}+), poi riprova. I modelli esistenti saranno riutilizzati.`,
        );
      return {
        ready: true,
        message: `Ollama ${service.version} collegato. Installazione esistente riutilizzata.`,
      };
    }
    if (await occupied(this.base))
      throw new Error(
        "La porta di Ollama è occupata da un servizio non riconosciuto. Controlla Ollama e riprova.",
      );
    const installed = await installedBinary(this.directory);
    if (!installed)
      return { ready: false, message: "Ollama non è installato." };
    if (!installed.compatible)
      throw new Error(
        `È presente Ollama ${installed.version}. Aggiorna questa installazione a ${manifest.minimumVersion}+ e riprova. SIAAS Personal non la sostituisce.`,
      );
    this.report({ message: "Avvio di Ollama già installato…" });
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const log = openSync(join(this.directory, "ollama.log"), "a", 0o600);
    const host = new URL(this.base).host;
    this.child = spawn(installed.binary, ["serve"], {
      env: { ...process.env, OLLAMA_HOST: host },
      windowsHide: true,
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    let failed = false;
    this.child.once("error", () => {
      failed = true;
    });
    this.child.once("exit", () => {
      failed = true;
    });
    for (let i = 0; i < 60; i++) {
      const ready = await probe(this.base);
      if (ready?.compatible)
        return {
          ready: true,
          message: "Ollama pronto. Puoi scegliere i modelli.",
        };
      if (ready && !ready.compatible) break;
      if (failed) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    this.child?.kill();
    this.child = null;
    throw new Error(
      "Ollama non si è avviato. Controlla il registro ollama.log nella cartella dati di SIAAS Personal o apri Ollama manualmente.",
    );
  }
  async install() {
    if (this.busy) throw new Error("Configurazione già in corso.");
    this.busy = true;
    try {
      const existing = await this.ensure();
      if (existing.ready) return existing;
      if (!manifest.platforms[`${process.platform}-${process.arch}`])
        throw new Error(
          "Installa Ollama dal sito ufficiale per questa architettura.",
        );
      await new Promise((resolve, reject) => {
        this.installer = spawn(this.node, [this.helper, this.directory], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let buffer = "",
          error = "";
        this.installer.stdout.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            try {
              this.report(JSON.parse(line));
            } catch {}
          }
        });
        this.installer.stderr.on("data", (chunk) => {
          error = (error + chunk).slice(-2000);
        });
        this.installer.once("error", reject);
        this.installer.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  error.trim() || "Installazione interrotta. Puoi riprovare.",
                ),
              ),
        );
      });
      return await this.ensure();
    } finally {
      this.busy = false;
      this.installer = null;
    }
  }
  cancel() {
    this.installer?.kill();
  }
  close() {
    this.cancel();
    this.child?.kill();
  }
}
module.exports = {
  versionCompatible,
  localURL,
  probe,
  occupied,
  managedBinary,
  installedBinary,
  OllamaManager,
};
