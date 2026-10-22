import { checkDocker } from "./docker-prerequisites.mjs";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = resolve(
    process.env.SIAAS_DATA_DIR || join(homedir(), ".siaas"),
  );
  const configPath = join(directory, "research-services.json");
  const action = process.argv[2] || "status";
  const feature = process.argv[3];
  if (action !== "status" && !["reasoning", "web"].includes(feature))
    throw Error(
      "Choose one service: npm run research:" + action + " -- reasoning|web",
    );
  const names =
    feature === "reasoning"
      ? ["laya"]
      : feature === "web"
        ? ["morphic"]
        : ["laya", "morphic"];
  if (!["setup", "start", "stop", "status"].includes(action))
    throw Error("Use setup, start, stop or status");
  let config;
  // Preserve the legacy shared token when migrating into the desktop data directory.
  for (const path of [
    join(homedir(), ".siaas", "research-services.json"),
    configPath,
  ]) {
    try {
      config = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
  }
  if (config && process.env.SIAAS_RESEARCH_TOKEN)
    config.token = process.env.SIAAS_RESEARCH_TOKEN;
  if (!config && action !== "setup")
    throw Error("Prima esegui npm run research:setup");
  if (!config) {
    config = {
      laya: "http://127.0.0.1:7821",
      morphic: "http://127.0.0.1:7822",
      token:
        process.env.SIAAS_RESEARCH_TOKEN || randomBytes(32).toString("hex"),
    };
  }
  // Never send a locally stored credential to a remote or redirected destination.
  for (const name of ["laya", "morphic"]) {
    const u = new URL(config[name]);
    if (
      u.origin !== `http://127.0.0.1:${name === "laya" ? 7821 : 7822}` ||
      u.username ||
      u.password
    )
      throw Error("Configurazione locale non valida");
  }
  if (typeof config.token !== "string" || config.token.length < 32)
    throw Error("Token locale non valido");
  const env = { ...process.env, SIAAS_RESEARCH_TOKEN: config.token };
  function run(command, args) {
    const child = spawnSync(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: false,
    });
    if (child.error)
      throw Error(
        `Unable to run ${command}: ${child.error.code || "execution failed"}. Check installation and permissions.`,
      );
    if (child.status !== 0) throw Error(`${command} non completato`);
  }
  const compose = ["compose", "-f", join(root, "services/compose.yml")];
  const request = (name, path, method = "GET") =>
    fetch(new URL(path, config[name]), {
      method,
      headers: { Authorization: `Bearer ${config.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
  if (action === "status") {
    for (const name of names) {
      try {
        const r = await request(name, "/health");
        console.log(
          `${name === "laya" ? "Advanced Reasoning (Beta)" : "Advanced Web Research (Beta)"}: ${r.ok ? "Ready" : "Unavailable"}`,
        );
      } catch {
        console.log(
          `${name === "laya" ? "Advanced Reasoning (Beta)" : "Advanced Web Research (Beta)"}: Unavailable`,
        );
      }
    }
  } else if (action === "stop") {
    if (feature === "web") {
      try {
        await request("morphic", "/shutdown", "POST");
      } catch {}
    }
    checkDocker();
    run("docker", [
      ...compose,
      "stop",
      feature === "reasoning" ? "laya" : "searxng",
    ]);
  } else {
    checkDocker();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    if (action === "setup" && feature === "web") {
      const candidates = [
        process.env.npm_execpath,
        join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
        join(
          dirname(process.execPath),
          "../lib/node_modules/npm/bin/npm-cli.js",
        ),
      ];
      const npm = candidates.find((p) => p && existsSync(p));
      if (!npm)
        throw Error(
          "The application npm runtime is missing. Repair the installation or use npm run research:setup from a source checkout.",
        );
      run(process.execPath, [
        npm,
        "ci",
        "--prefix",
        "services/morphic",
        "--ignore-scripts",
      ]);
      run(process.execPath, ["services/morphic/build.mjs"]);
    }
    run("docker", [
      ...compose,
      "up",
      "-d",
      "--no-deps",
      ...(action === "setup" ? ["--build"] : []),
      feature === "reasoning" ? "laya" : "searxng",
    ]);
    if (feature === "reasoning") {
      console.log(
        "Advanced Reasoning (Beta) startup requested. The model downloads on first startup.",
      );
      return;
    }
    // Authenticated shutdown avoids signalling a reused/unrelated PID.
    try {
      await request("morphic", "/shutdown", "POST");
    } catch {}
    const log = openSync(join(directory, "morphic-service.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      [join(root, "services/morphic/dist/server.mjs")],
      {
        cwd: root,
        env: {
          ...env,
          SIAAS_RESEARCH_BIND: "127.0.0.1",
          OLLAMA_BASE_URL:
            process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
          SEARXNG_BASE_URL: "http://127.0.0.1:7823",
        },
        detached: true,
        stdio: ["ignore", log, log],
        windowsHide: true,
      },
    );
    child.on("error", () => {
      console.error(
        "Advanced Web Research could not start. Check the local research service log.",
      );
      process.exitCode = 1;
    });
    child.unref();
    closeSync(log);
    console.log(
      "Startup requested. The evidence model downloads on first startup. Check npm run research:status or the assistant settings.",
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
