import { lstatSync, realpathSync, rmdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep))
  );
};

// Only fixed, app-owned legacy locations. Never recursively scan user folders.
// rmdir is deliberately non-recursive: nonempty directories are always retained.
export function removeEmptyLegacyDirectories(
  directory: string,
  assistants: { id: string; project_id: string }[],
  sourcePaths: string[],
) {
  const root = resolve(directory);
  const candidates = [join(root, "skills"), join(root, "supabase")];
  const id = /^[a-f0-9-]{36}$/;
  for (const assistant of assistants) {
    if (id.test(assistant.id) && id.test(assistant.project_id))
      candidates.push(
        join(
          root,
          "projects",
          assistant.project_id,
          "assistants",
          assistant.id,
          "skills",
        ),
      );
  }
  const sources = sourcePaths.flatMap((path) => {
    if (typeof path !== "string" || !isAbsolute(path)) return [];
    try {
      return [resolve(path), realpathSync(path)];
    } catch {
      return [resolve(path)];
    }
  });
  for (const candidate of candidates) {
    try {
      // Reject symlinks at every component below the configured data root.
      let current = root;
      let linked = false;
      for (const part of relative(root, candidate).split(sep)) {
        current = join(current, part);
        if (lstatSync(current).isSymbolicLink()) {
          linked = true;
          break;
        }
      }
      if (linked || !lstatSync(candidate).isDirectory()) continue;
      const canonical = realpathSync(candidate);
      if (
        sources.some(
          (source) =>
            inside(source, candidate) ||
            inside(candidate, source) ||
            inside(source, canonical) ||
            inside(canonical, source),
        )
      )
        continue;
      rmdirSync(candidate);
    } catch {
      // Missing, nonempty, read-only or inaccessible: preserve and continue startup.
    }
  }
}
