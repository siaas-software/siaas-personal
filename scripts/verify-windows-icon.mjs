// Read-only verification of an actual packaged executable. Run on the built EXE,
// not the NSIS installer. A resource match does not prove taskbar cache behavior.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NtExecutable, NtExecutableResource, Resource, Data } from "resedit";
const path = process.argv[2];
assert(
  path?.toLowerCase().endsWith(".exe"),
  "Usage: npm run icons:verify-windows -- <packaged SIAAS Personal.exe>",
);
const executable = await readFile(path);
const expected = Data.IconFile.from(
  await readFile(new URL("../build/icon.ico", import.meta.url)),
).icons.map((entry) => entry.data);
const digest = (data) =>
  createHash("sha256").update(Buffer.from(data)).digest("hex");
const signature = (icons) =>
  icons
    .map((icon) => {
      assert(
        icon.isRaw(),
        "Expected the original PNG icon frames, not a substituted bitmap",
      );
      return `${icon.width}x${icon.height}:${digest(icon.bin)}`;
    })
    .sort();
const entries = NtExecutableResource.from(
  NtExecutable.from(executable, { ignoreCert: true }),
).entries;
const groups = Resource.IconGroupEntry.fromEntries(entries);
assert(groups.length > 0, "Executable has no icon groups");
for (const group of groups)
  assert.deepEqual(
    signature(group.getIconItemsFromEntries(entries)),
    signature(expected),
    `Icon group ${group.id}/${group.lang} differs from official artwork`,
  );
console.log(
  JSON.stringify(
    {
      status: "PASS",
      executable: path,
      sha256: digest(executable),
      iconGroups: groups.length,
      sizes: expected.map((icon) => icon.width),
    },
    null,
    2,
  ),
);
