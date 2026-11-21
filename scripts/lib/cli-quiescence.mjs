// Managed launch leases only. Never enumerate unrelated PIDs or signal a process.
import {
  readFileSync,
  readlinkSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
const missing = (e) => ["ENOENT", "ESRCH"].includes(e.code);
export function processIdentity(pid, host = { readFileSync, readlinkSync }) {
  const text = host.readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = text
    .slice(text.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  if (fields.length < 20 || !/^\d+$/.test(fields[19]))
    throw Error("Ambiguous owned process identity.");
  return { start: fields[19], state: fields[0] };
}
export function leaseRunning(
  record,
  root,
  host = { readFileSync, readlinkSync },
) {
  if (
    !record ||
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 1 ||
    typeof record.start !== "string" ||
    record.start.length > 30 ||
    !/^\d+$/.test(record.start) ||
    typeof record.boot !== "string" ||
    !/^[a-f0-9-]{36}$/.test(record.boot) ||
    typeof record.executable !== "string" ||
    !resolve(record.executable).startsWith(resolve(root, "versions") + sep)
  )
    throw Error("Invalid managed instance lease.");
  if (
    record.boot !==
    host.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  )
    return false;
  let identity;
  try {
    identity = processIdentity(record.pid, host);
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
  if (identity.start !== record.start || identity.state === "Z") return false;
  const executable = host
    .readlinkSync(`/proc/${record.pid}/exe`)
    .replace(/ \(deleted\)$/, "");
  if (executable !== record.executable)
    throw Error("Owned process executable identity changed.");
  return true;
}
export function requireStopped(root, item) {
  const lease = join(root, "instance.json");
  if (existsSync(lease)) {
    const bytes = readFileSync(lease);
    if (bytes.length > 65536) throw Error("Oversized managed lease.");
    if (leaseRunning(JSON.parse(bytes), root))
      throw Error("Managed Personal is running; close it and retry.");
    rmSync(lease);
  }
  if (item) {
    if (item.cliManaged !== 1 || item.instanceProtocol !== 1)
      throw Error(
        "Unverified managed launch protocol; explicit recovery required.",
      );
    return;
  }
  if (
    existsSync(join(root, "versions")) &&
    readdirSync(join(root, "versions")).length
  )
    throw Error("Ambiguous partial installation; explicit recovery required.");
  const owner = JSON.parse(readFileSync(join(root, "cli-owner.json"), "utf8"));
  if (
    owner.schemaVersion !== 1 ||
    owner.protocol !== "siaas.personal.first-party-m2" ||
    owner.root !== root ||
    !existsSync(join(root, ".cli-lock"))
  )
    throw Error("Fresh install requires exclusive CLI ownership.");
}
export function captureLease(pid, executable) {
  const identity = processIdentity(pid);
  return {
    schemaVersion: 1,
    pid,
    start: identity.start,
    boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    executable,
  };
}
