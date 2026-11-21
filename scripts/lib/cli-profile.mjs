import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
// Caller holds operation lock and has verified no managed instance is running.
export function coldBackup(root) {
  const profile = join(root, "profile");
  if (!existsSync(profile)) return;
  const dest = join(root, "backups", "cold-" + Date.now());
  let bytes = 0;
  function copy(src, out) {
    const stat = lstatSync(src);
    if (stat.isSymbolicLink()) throw Error("Profile symlink refused.");
    if (stat.isDirectory()) {
      mkdirSync(out, { recursive: true, mode: 0o700 });
      for (const name of readdirSync(src))
        copy(join(src, name), join(out, name));
      return;
    }
    if (!stat.isFile() || (bytes += stat.size) > 1024 ** 3)
      throw Error("Profile cold-backup policy refused.");
    writeFileSync(out, readFileSync(src), { mode: 0o600, flag: "wx" });
  }
  copy(profile, dest);
}
