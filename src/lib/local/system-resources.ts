import { cpus, freemem, totalmem, platform } from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SystemResources } from "../overview";
const run = promisify(execFile);
const number = (value: string): number | null =>
  value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : null;
const cpuSample = () =>
  cpus().reduce(
    (s, c) => ({
      idle: s.idle + c.times.idle,
      total: s.total + Object.values(c.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );
let previousCPU: ReturnType<typeof cpuSample> | null = null;
let previousDisks: {
  time: number;
  values: Map<string, { read: number; write: number }>;
} | null = null;
async function gpuResources(): Promise<SystemResources["gpus"]> {
  try {
    const { stdout } = await run(
      "nvidia-smi",
      [
        "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 2000, maxBuffer: 32000, windowsHide: true },
    );
    return stdout
      .trim()
      .split("\n")
      .flatMap((line) => {
        const cells = line.split(",").map((v) => v.trim());
        if (cells.length !== 6) return [];
        const [name, utilization, used, total, temperature, power] = cells;
        const bytes = (v: string) => {
          const n = number(v);
          return n === null ? null : n * 1024 ** 2;
        };
        return [
          {
            name,
            utilization: number(utilization),
            memoryUsed: bytes(used),
            memoryTotal: bytes(total),
            temperature: number(temperature),
            power: number(power),
          },
        ];
      });
  } catch {
    return [];
  }
}
async function temperature(): Promise<number | null> {
  if (platform() !== "linux") return null;
  try {
    const paths = await readdir("/sys/class/thermal");
    for (const path of paths.filter((p) => /^thermal_zone\d+$/.test(p))) {
      const type = await readFile(`/sys/class/thermal/${path}/type`, "utf8");
      if (!/x86_pkg_temp|cpu-thermal/i.test(type)) continue;
      const value = number(
        await readFile(`/sys/class/thermal/${path}/temp`, "utf8"),
      );
      if (value !== null) return value / 1000;
    }
  } catch {
    /* Sensor unavailable. */
  }
  return null;
}
async function disks(): Promise<SystemResources["disks"]> {
  try {
    if (platform() === "win32") {
      const { stdout } = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object Name -ne '_Total' | Select-Object Name,DiskReadBytesPersec,DiskWriteBytesPersec | ConvertTo-Json -Compress",
        ],
        { timeout: 2000, maxBuffer: 32000, windowsHide: true },
      );
      const parsed = JSON.parse(stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((d) => {
        const read = number(String(d.DiskReadBytesPersec)),
          write = number(String(d.DiskWriteBytesPersec));
        return read === null || write === null
          ? []
          : [
              {
                name: String(d.Name),
                readBytesPerSecond: read,
                writeBytesPerSecond: write,
              },
            ];
      });
    }
    if (platform() !== "linux") return [];
    const [raw, devices] = await Promise.all([
      readFile("/proc/diskstats", "utf8"),
      readdir("/sys/block"),
    ]);
    const values = new Map<string, { read: number; write: number }>();
    for (const line of raw.trim().split("\n")) {
      const cells = line.trim().split(/\s+/),
        name = cells[2];
      if (!devices.includes(name) || /^(loop|ram|dm-)/.test(name)) continue;
      values.set(name, {
        read: Number(cells[5]) * 512,
        write: Number(cells[9]) * 512,
      });
    }
    const now = performance.now(),
      prev = previousDisks;
    previousDisks = { time: now, values };
    if (!prev || now <= prev.time) return [];
    return [...values].flatMap(([name, v]) => {
      const old = prev.values.get(name),
        seconds = (now - prev.time) / 1000;
      if (!old || v.read < old.read || v.write < old.write) return [];
      return [
        {
          name,
          readBytesPerSecond: (v.read - old.read) / seconds,
          writeBytesPerSecond: (v.write - old.write) / seconds,
        },
      ];
    });
  } catch {
    return [];
  }
}
async function sample(): Promise<SystemResources> {
  if (!previousCPU) {
    previousCPU = cpuSample();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const current = cpuSample(),
    delta = current.total - previousCPU.total;
  const percent =
    delta > 0
      ? Math.max(
          0,
          Math.min(100, 100 * (1 - (current.idle - previousCPU.idle) / delta)),
        )
      : null;
  previousCPU = current;
  const [gpus, cpuTemperature, diskActivity] = await Promise.all([
    gpuResources(),
    temperature(),
    disks(),
  ]);
  return {
    sampledAt: new Date().toISOString(),
    cpuPercent: percent,
    cpuName: cpus()[0]?.model ?? "CPU",
    ramUsed: totalmem() - freemem(),
    ramTotal: totalmem(),
    gpus,
    cpuTemperature,
    disks: diskActivity,
  };
}
let pending: Promise<SystemResources> | null = null;
let cached: SystemResources | null = null;
export async function systemResources() {
  if (cached && Date.now() - Date.parse(cached.sampledAt) < 1500) return cached;
  if (!pending)
    pending = sample()
      .then((result) => (cached = result))
      .finally(() => {
        pending = null;
      });
  return pending;
}
