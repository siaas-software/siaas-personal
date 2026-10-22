const { DatabaseSync, backup } = require("node:sqlite");
const { existsSync, mkdirSync, readdirSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");
async function run() {
  const directory = process.argv[2];
  const source = join(directory, "siaas.sqlite");
  if (!existsSync(source)) return;
  const destination = join(directory, "backups");
  mkdirSync(destination, { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, join(destination, `before-update-${Date.now()}.sqlite`));
  } finally {
    db.close();
  }
  const old = readdirSync(destination)
    .filter((n) => /^before-update-\d+\.sqlite$/.test(n))
    .sort()
    .slice(0, -3);
  for (const name of old) unlinkSync(join(destination, name));
}
run().catch(() => {
  console.error("Database backup failed");
  process.exitCode = 1;
});
