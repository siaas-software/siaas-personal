const {
  app,
  BrowserWindow,
  session,
  shell,
  dialog,
  ipcMain,
} = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { createServer } = require("node:net");
const { join, isAbsolute } = require("node:path");
const { existsSync, statSync, mkdirSync } = require("node:fs");
const { OllamaManager } = require("./ollama-manager.cjs");
const ollamaAssets = require("./ollama-assets.json");
const { DesktopUpdates } = require("./updates.cjs");
let ollama, updates;
let installing = false;
const activeMutations = new Set();
// Keep the established data directory across the product rename.
// This preserves projects, documents, sessions and the managed Ollama installation.
const userDataDirectory = app.commandLine.getSwitchValue("user-data-dir") ||
  join(app.getPath("appData"), "SIAAS");
mkdirSync(userDataDirectory, { recursive: true });
app.setPath("userData", userDataDirectory);
app.setName("SIAAS Personal");
let backend,
  win,
  shuttingDown = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    shuttingDown = true;
    backend?.kill();
    ollama?.close();
  });
  app
    .whenReady()
    .then(start)
    .catch((e) => {
      dialog.showErrorBox("Unable to start SIAAS Personal", e.message);
      app.quit();
    });
}
async function start() {
  const node = app.isPackaged
    ? join(
        process.resourcesPath,
        "runtime",
        process.platform === "win32" ? "node.exe" : "node",
      )
    : process.env.SIAAS_NODE_EXECUTABLE;
  if (!node) throw new Error("Start SIAAS Personal from the terminal with npm run desktop.");
  const root = join(__dirname, "..");
  const serverDir = app.isPackaged
    ? join(process.resourcesPath, "server")
    : join(root, ".next", "standalone");
  const serverFile = join(serverDir, "server.js");
  if (!existsSync(serverFile))
    throw new Error("Run npm run desktop:build first.");
  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString("hex");
  const childEnv = {
    ...process.env,
    SIAAS_DESKTOP_DEV: app.isPackaged ? "0" : "1",
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    SIAAS_RUNTIME: "desktop",
    SIAAS_DESKTOP_KEY: secret,
    SIAAS_DESKTOP_ORIGIN: origin,
    SIAAS_DATA_DIR: app.getPath("userData"),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.VERCEL;
  backend = spawn(node, [serverFile], {
    cwd: serverDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let tail = "";
  backend.stdout.on("data", (b) => {
    tail = (tail + b).slice(-3000);
  });
  backend.stderr.on("data", (b) => {
    tail = (tail + b).slice(-3000);
  });
  let failed;
  backend.on("error", (e) => {
    failed = e;
  });
  backend.on("exit", () => {
    if (!shuttingDown) {
      failed = new Error("Il servizio locale si è chiuso. " + tail);
      if (win) {
        dialog.showErrorBox("Servizio locale interrotto", failed.message);
        app.quit();
      }
    }
  });
  for (let attempt = 0; ; attempt++) {
    if (failed) throw failed;
    if (attempt > 120)
      throw new Error("Il servizio locale non risponde. " + tail);
    try {
      const r = await fetch(origin, {
        headers: { "x-siaas-desktop-key": secret },
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) break;
    } catch {
      /* wait for server */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const ses = session.fromPartition("siaas-desktop"); // temporary browser session; user data is SQLite
  ses.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const local = new URL(details.url).origin === origin;
    // Documents and model output stay inside the local origin. External links use the OS browser.
    if (!local) return callback({ cancel: true });
    if (installing) return callback({ cancel: true });
    if (!["GET", "HEAD"].includes(details.method))
      activeMutations.add(details.id);
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        "x-siaas-desktop-key": secret,
      },
    });
  });
  ses.webRequest.onCompleted((details) => activeMutations.delete(details.id));
  ses.webRequest.onErrorOccurred((details) =>
    activeMutations.delete(details.id),
  );
  ses.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'",
        ],
      },
    }),
  );
  win = new BrowserWindow({
    title: "SIAAS Personal",
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f7f8f6",
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const allowed = new Set([
    "ollama.com",
    "docs.ollama.com",
    "github.com",
    "siaas-siaas-team.vercel.app",
    "siaas.vercel.app",
    "ai.google.dev",
  ]);
  const openExternal = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && allowed.has(u.hostname))
        void shell.openExternal(u.href);
    } catch {}
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      openExternal(url);
    }
  });
  ollama = new OllamaManager({
    directory: join(app.getPath("userData"), "ollama"),
    node,
    helper: app.isPackaged
      ? join(process.resourcesPath, "helpers", "install-ollama.cjs")
      : join(__dirname, "install-ollama.cjs"),
    report: (progress) => {
      if (win && !win.isDestroyed())
        win.webContents.send("siaas:setup-progress", progress);
    },
  });
  const trusted = (event) =>
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === origin;
  const installRoot = process.env.SIAAS_INSTALL_DIR || (process.platform === "win32" ? join(process.env.LOCALAPPDATA || join(require("node:os").homedir(), "AppData", "Local"), "SIAAS Personal Source") : join(require("node:os").homedir(), ".local", "share", "siaas-personal-source"));
  const sourceManager = join(installRoot, "source-manager.mjs");
  const { existsSync: sourceExists } = require("node:fs");
  const managerPath = process.env.SIAAS_SOURCE_MANAGER || sourceManager;
  updates = new DesktopUpdates({
    version: app.getVersion(),
    supported: sourceExists(managerPath),
    notify: (state) => {
      if (win && !win.isDestroyed()) win.webContents.send("siaas:update-state", state);
    },
  });
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) throw new Error("Richiesta non valida.");
      return await fn(...args);
    });
  handle("siaas:choose-knowledge-folder", async () => {
    const result = await dialog.showOpenDialog(win, { title: "Collega una cartella ai documenti dell’assistente", properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  const openDirectory = async (path) => {
    if (typeof path !== "string" || path.length > 4096 || !isAbsolute(path) || !statSync(path).isDirectory())
      throw new Error("Cartella non disponibile.");
    const error = await shell.openPath(path);
    if (error) throw new Error("Impossibile aprire la cartella.");
  };
  handle("siaas:open-knowledge-folder", openDirectory);
  handle("siaas:open-data-directory", () => openDirectory(app.getPath("userData")));


  handle("siaas:update-state", () => updates.state);
  handle("siaas:check-update", () => updates.check());
  handle("siaas:install-update", async () => {
    if (updates.state.phase !== "available") throw new Error("No stable update available.");
    if (activeMutations.size || setupPending) throw new Error("Finish current work before updating.");
    if (!sourceExists(managerPath)) throw new Error("Source manager not found.");
    const choice = await dialog.showMessageBox(win, {
      type: "question",
      title: "Update SIAAS Personal",
      message: "Restart and build the latest stable release from source?",
      detail: "SIAAS Personal will close during the update. Existing local data will be preserved. Application rollback does not undo database migrations.",
      buttons: ["Update Now", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response !== 0) return updates.state;
    const externalNode = process.env.SIAAS_SOURCE_NODE;
    if (!externalNode || !require("node:path").isAbsolute(externalNode) || !sourceExists(externalNode)) throw new Error("Managed Node.js runtime unavailable. Rerun the official installer.");
    const fs = require("node:fs");
    const log = fs.openSync(require("node:path").join(process.env.SIAAS_INSTALL_DIR || require("node:path").dirname(managerPath), "update.log"), "a", 0o600);
    const child = spawn(externalNode, [managerPath, "update-detached", String(process.pid)], {
      detached: true, stdio: ["ignore", log, log], windowsHide: true,
    });
    fs.closeSync(log);
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    updates.set({phase:"activating",message:"Closing application to update from source…"});
    installing = true;
    app.quit();
    return updates.state;
  });
  let setupPending = false;
  let setupError = "";
  ipcMain.handle("siaas:setup-error", (event) =>
    trusted(event) ? setupError : "Richiesta non valida.",
  );
  ipcMain.handle("siaas:setup-ollama", async (event) => {
    if (!trusted(event))
      return { ok: false, error: "Richiesta non valida." };
    if (setupPending)
      return { ok: false, error: "Configurazione già in corso." };
    setupPending = true;
    try {
      const status = await ollama.ensure();
      setupError = "";
      if (status.ready) return { ok: true, message: status.message };
      const asset =
        ollamaAssets.platforms[`${process.platform}-${process.arch}`];
      if (!asset)
        throw new Error(
          "Questa architettura richiede l’installazione di Ollama dal sito ufficiale.",
        );
      const choice = await dialog.showMessageBox(win, {
        type: "question",
        title: "Configura Ollama",
        buttons: ["Scarica e installa", "Annulla"],
        defaultId: 0,
        cancelId: 1,
        message: `Installare Ollama ${ollamaAssets.version}?`,
        detail: `Download ufficiale: circa ${Math.ceil(asset.bytes / 1024 ** 2)} MB. Verrà installato nella cartella dati di SIAAS Personal, senza modificare altre applicazioni. I modelli si scelgono dopo. Occorrono fino a 7 GB liberi per l’installazione.`,
      });
      if (choice.response !== 0)
        return { ok: false, error: "Installazione annullata." };
      const result = await ollama.install();
      return { ok: result.ready, message: result.message };
    } catch (e) {
      setupError = e.message;
      return { ok: false, error: e.message };
    } finally {
      setupPending = false;
    }
  });
  ipcMain.handle("siaas:cancel-setup", (event) => {
    if (trusted(event)) ollama.cancel();
  });
  // Reuse/start existing Ollama; downloading always requires the setup button.
  await ollama.ensure().catch((error) => {
    setupError = error.message;
  });
  await win.loadURL(origin);
  if (updates.supported) {
    void updates.check();
  }
}
