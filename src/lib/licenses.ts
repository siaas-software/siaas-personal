import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Fixed local paths only: never accept a filename or URL from the renderer.
export const LICENSE_DOCUMENTS = [
  {
    id: "notices",
    title: "Third-Party Notices",
    path: "THIRD_PARTY_NOTICES.md",
  },
  { id: "siaas", title: "SIAAS Personal — MIT License", path: "LICENSE" },
  {
    id: "laya",
    title: "Laya — Apache-2.0 License",
    path: "services/laya/LICENSE",
  },
  {
    id: "morphic",
    title: "Morphic — Apache-2.0 License",
    path: "services/morphic/LICENSE",
  },
  {
    id: "morphic-notice",
    title: "Morphic — Adaptation Notice",
    path: "services/morphic/NOTICE",
  },
] as const;

export type LicenseDocument = { id: string; title: string; content: string };

export async function readLicenseDocuments(
  root = process.cwd(),
): Promise<LicenseDocument[]> {
  return Promise.all(
    LICENSE_DOCUMENTS.map(async ({ id, title, path }) => ({
      id,
      title,
      content: await readFile(join(root, path), "utf8"),
    })),
  );
}
