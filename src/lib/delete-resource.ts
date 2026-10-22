import type { LocalDatabase } from "./local/database";

export async function removeAssistantFiles(
  db: LocalDatabase,
  tenantId: string,
  assistantId: string,
) {
  {
    const { rmSync } = await import("node:fs");
    const local = db;
    // Only SIAAS-Personal-managed copies and indexes; linked folders are never traversed.
    rmSync(local.assistantDirectory(assistantId), {
      recursive: true,
      force: true,
    });
  }
  // Paginate to include every uploaded file, even beyond the API's row limit.
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from("documents")
      .select("id,storage_path")
      .eq("tenant_id", tenantId)
      .eq("assistant_id", assistantId)
      .order("id")
      .range(offset, offset + 99);
    if (error) throw error;
    const paths = (data ?? [])
      .map((d) => d.storage_path)
      .filter((p): p is string => !!p);
    if (paths.length) {
      const { error: storageError } = await db.storage
        .from("documents")
        .remove(paths);
      if (storageError) throw storageError;
    }
    if (!data || data.length < 100) break;
  }
}
export async function removeProjectFiles(
  db: LocalDatabase,
  tenantId: string,
  projectId: string,
) {
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from("assistants")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("id")
      .range(offset, offset + 99);
    if (error) throw error;
    for (const a of data ?? []) await removeAssistantFiles(db, tenantId, a.id);
    if (!data || data.length < 100) break;
  }
}
