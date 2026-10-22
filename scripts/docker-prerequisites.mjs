import { spawnSync, execFile } from "node:child_process";

export function dockerHelp(platform = process.platform) {
  return platform === "linux"
    ? "Install Docker Engine with the Docker Compose v2 plugin, start the Docker daemon, and check your user can access it. Use Linux containers (Engine 20.10+)."
    : `Install Docker Desktop for ${platform === "win32" ? "Windows" : "macOS"}, start Docker Desktop, and wait until the engine is running. Use Linux containers and Docker Compose v2.`;
}
const probes = [
  ["--version"],
  ["compose", "version", "--short"],
  ["info", "--format", "{{json .}}"],
];
function evaluate(results, platform) {
  const [cli, compose, daemon] = results;
  let reason = "ready";
  let message = "Docker is ready.";
  if (cli.error?.code === "ENOENT") {
    reason = "not_installed";
    message =
      "Docker was not found on this computer. Reopen your terminal after installing Docker.";
  } else if (cli.error || cli.status !== 0) {
    reason = "inaccessible";
    message =
      "The Docker executable could not be run. Check installation, PATH and execution permissions.";
  } else if (
    compose.error ||
    compose.status !== 0 ||
    !/^v?2\./.test(compose.stdout?.trim() || "")
  ) {
    reason = "compose_unavailable";
    message =
      "Docker Compose is unavailable or unsupported. Install or repair the Compose v2 plugin.";
  } else if (daemon.error || daemon.status !== 0) {
    reason = "engine_unavailable";
    message =
      "The Docker daemon is unavailable. Check that Docker is running and that your user has permission to access it.";
  } else {
    let info;
    try {
      info = JSON.parse(daemon.stdout);
    } catch {}
    const version = info?.ServerVersion?.split(".").map(Number);
    if (
      info?.OSType !== "linux" ||
      !["x86_64", "aarch64", "amd64", "arm64"].includes(info?.Architecture) ||
      !version ||
      !(version[0] > 20 || (version[0] === 20 && version[1] >= 10))
    ) {
      reason = "unsupported_engine";
      message =
        "Docker requires Linux containers, an x64 or arm64 engine, and Engine 20.10 or newer.";
    }
  }
  return {
    ready: reason === "ready",
    reason,
    message,
    help: dockerHelp(platform),
  };
}
export function checkDocker({
  platform = process.platform,
  run = spawnSync,
} = {}) {
  const results = [];
  for (const args of probes) {
    results.push(
      run("docker", args, {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 5000,
      }),
    );
    const last = results.at(-1);
    if (last.error || last.status !== 0) break;
  }
  const result = evaluate(results, platform);
  if (!result.ready)
    throw Error(
      `Advanced Reasoning and Advanced Web Research require Docker.\n\n${result.message}\n\n${result.help}\nVerify with docker --version, docker compose version and docker info, then retry.\nThe rest of SIAAS Personal can be used without Docker.`,
    );
  return result;
}
const execute = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => resolve({ error, status: error ? 1 : 0, stdout }),
    );
  });
// Read-only, bounded probes. No installation, container start, or cached readiness.
export async function inspectDocker({
  platform = process.platform,
  run = execute,
} = {}) {
  const results = [];
  for (const args of probes) {
    results.push(await run("docker", args));
    const last = results.at(-1);
    if (last.error || last.status !== 0) break;
  }
  return evaluate(results, platform);
}
