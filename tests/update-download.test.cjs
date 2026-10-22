const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { AppImageUpdater } = require("electron-updater");
const { NodeHttpExecutor } = require("builder-util/out/nodeHttpExecutor");

test("real electron-updater follows a temporary asset redirect, verifies SHA-512 and rejects corruption without installation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "siaas-update-download-"));
  const oldImage = process.env.APPIMAGE;
  const oldArch = process.env.TEST_UPDATER_ARCH;
  process.env.TEST_UPDATER_ARCH = "x64";
  const oldProxy = process.env.http_proxy;
  delete process.env.http_proxy;
  process.env.APPIMAGE = join(directory, "old.AppImage");
  const bytes = Buffer.from("fixture update payload, never executed");
  let corrupt = false;
  const name = "SIAAS-Personal-1.3.0-linux-x86_64.AppImage";
  const manifest = {
    version: "1.3.0",
    files: [
      {
        url: name,
        sha512: createHash("sha512").update(bytes).digest("base64"),
        size: bytes.length,
      },
    ],
    releaseDate: new Date().toISOString(),
  };
  const service = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    if (req.url.startsWith("/feed/latest-linux.yml"))
      res.end(JSON.stringify(manifest));
    else if (req.url === "/feed/" + name) {
      res.writeHead(302, { Location: origin + "/temporary-cdn-file" });
      res.end();
    } else if (req.url === "/temporary-cdn-file")
      res.end(corrupt ? Buffer.from("corrupt") : bytes);
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${service.address().port}`;
  try {
    await writeFile(
      join(directory, "app-update.yml"),
      "updaterCacheDirName: update-test\n",
    );
    await writeFile(process.env.APPIMAGE, "previous application");
    function make(suffix) {
      const updater = new AppImageUpdater(null, {
        version: "1.2.0",
        name: "SIAAS Personal",
        isPackaged: true,
        appUpdateConfigPath: join(directory, "app-update.yml"),
        userDataPath: directory,
        baseCachePath: join(directory, suffix),
        whenReady: async () => {},
        onQuit: () => {},
        quit: () => {
          throw new Error("Must not install");
        },
        relaunch: () => {
          throw new Error("Must not launch");
        },
      });
      updater._testOnlyOptions = { platform: "linux" };
      updater.httpExecutor = new NodeHttpExecutor();
      // Same downloader/integrity pipeline as Electron, with Node HTTP transport
      // so the unit runner needs neither a GUI nor an installed application.
      updater.httpExecutor.download =
        require("electron-updater/out/electronHttpExecutor").ElectronHttpExecutor.prototype.download;
      updater.logger = null;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.disableDifferentialDownload = true;
      updater.setFeedURL({
        provider: "generic",
        url: origin + "/feed/",
        useMultipleRangeRequest: false,
      });
      return updater;
    }
    const good = make("good");
    assert.equal((await good.checkForUpdates()).isUpdateAvailable, true);
    const [path] = await good.downloadUpdate();
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(
      (await readFile(process.env.APPIMAGE)).toString(),
      "previous application",
    );
    corrupt = true;
    const bad = make("bad");
    await bad.checkForUpdates();
    await assert.rejects(bad.downloadUpdate(), /checksum|sha512/i);
  } finally {
    if (oldArch === undefined) delete process.env.TEST_UPDATER_ARCH;
    else process.env.TEST_UPDATER_ARCH = oldArch;
    if (oldProxy === undefined) delete process.env.http_proxy;
    else process.env.http_proxy = oldProxy;
    if (oldImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = oldImage;
    service.closeAllConnections();
    await new Promise((resolve) => service.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
