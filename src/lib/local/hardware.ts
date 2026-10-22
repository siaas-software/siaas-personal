import { totalmem, freemem, cpus, platform, arch, homedir } from "node:os";
import { statfsSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Hardware } from "../hardware";
const run = promisify(execFile);
export async function detectHardware() {
  const ram = Math.round(totalmem() / 1024 ** 3);
  const freeRam = Math.floor(freemem() / 1024 ** 3);
  const modelDir =
    process.env.OLLAMA_MODELS || join(homedir(), ".ollama", "models");
  const diskPath = existsSync(/* turbopackIgnore: true */ modelDir)
    ? modelDir
    : homedir();
  const diskInfo = statfsSync(diskPath);
  const disk = Math.floor((diskInfo.bavail * diskInfo.bsize) / 1024 ** 3);
  let gpu: Hardware["gpu"] =
    platform() === "darwin" && arch() === "arm64" ? "unified" : "cpu";
  let vram = 0,
    gpuName = gpu === "unified" ? "Apple Silicon" : "GPU non rilevata";
  if (gpu !== "unified") {
    try {
      const { stdout } = await run(
        "nvidia-smi",
        ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
        { timeout: 2500, maxBuffer: 16000, windowsHide: true },
      );
      const devices = stdout
        .trim()
        .split("\n")
        .map((line) => {
          const i = line.lastIndexOf(",");
          return {
            name: line.slice(0, i).trim(),
            gb: Number(line.slice(i + 1)) / 1024,
          };
        })
        .filter((d) => Number.isFinite(d.gb))
        .sort((a, b) => b.gb - a.gb);
      if (devices.length) {
        gpu = "dedicated";
        vram = Math.round(devices[0].gb);
        gpuName = devices[0].name;
      }
    } catch {
      /* CPU fallback: AMD/Intel can be entered manually, never guess VRAM. */
    }
  }
  return {
    hardware: { ram, gpu, vram, disk },
    freeRam,
    cpu: cpus()[0]?.model || arch(),
    platform: platform(),
    gpuName,
    diskPath,
    note: "RAM and disk detected on this PC. NVIDIA and Apple Silicon detected when available; check GPU and disk settings if Ollama uses another drive. Free RAM changes during use.",
  };
}
