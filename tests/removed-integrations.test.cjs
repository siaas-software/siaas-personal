const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

test("active source and distributions have no removed SDK, account bridge or Skills loader", () => {
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        assert(!/^(supabase|skills)$/i.test(entry.name), path);
        scan(path);
      } else if (/\.(ts|tsx|cjs|mjs|sh|ps1|json)$/.test(path)) {
        if (path.endsWith("legacy-cleanup.ts")) continue;
        assert(
          !/supabase|DesktopAccount|siaas:account|\/login|onAccountState/i.test(
            readFileSync(path, "utf8"),
          ),
          path,
        );
      }
    }
  }
  for (const path of ["src", "desktop", "scripts"]) scan(path);
  for (const path of [
    "package.json",
    "package-lock.json",
    "services/morphic/package-lock.json",
  ])
    assert(!/supabase/i.test(readFileSync(path, "utf8")), path);
  for (const path of [
    "supabase",
    "src/app/api/desktop/config",
    "src/app/api/desktop/releases",
    "src/app/api/desktop/updates",
  ])
    assert(!existsSync(path), path);
  // Development instructions are deliberately preserved.
  assert(existsSync(".claude/skills/siaas-deploy/SKILL.md"));
});
