import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const env = {
  ...process.env,
  SIAAS_BUILD_DESKTOP: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};
// Build a clean standalone app, without stale web-build output or compiler caches.
rmSync(".next", { recursive: true, force: true });
// Keep local credentials and Vercel OIDC tokens out of the standalone bundle.
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  { env, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
for (const file of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
])
  rmSync(join(".next/standalone", file), { force: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public"))
  cpSync("public", ".next/standalone/public", { recursive: true });
console.log("SIAAS Personal desktop pronto. Avvia con npm run desktop.");

// Optional research lifecycle assets must also exist beside the standalone server.
cpSync("services", ".next/standalone/services", {
  recursive: true,
  filter: (path) => !/(?:^|[/\\])(node_modules|dist)(?:[/\\]|$)/.test(path),
});
mkdirSync(".next/standalone/scripts", { recursive: true });
for (const file of ["research-services.mjs", "docker-prerequisites.mjs"]) {
  cpSync(join("scripts", file), join(".next/standalone/scripts", file), {
    recursive: true,
  });
}
