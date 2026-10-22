import type { LocalDatabase } from "./database";
import { LOCAL_USER_ID } from "../runtime";
import { templateProjectSchema } from "../templates";
import { registerWebSource } from "./web-knowledge";

// Register the complete project in one transaction before any network operation.
export function importLocalTemplate(
  db: LocalDatabase,
  input: unknown,
  projectId?: string,
  templateId?: string,
) {
  const config = templateProjectSchema.parse(input);
  const result = db.transaction(() => {
    const existing = projectId ? db.get("projects", projectId) : null;
    if (projectId && !existing) throw new Error("Project not found.");
    if (
      existing &&
      db.rows("assistants").some((a) => a.project_id === projectId)
    )
      throw new Error(
        "Import into an empty project to preserve existing assistants.",
      );
    const { assistants, ...fields } = config;
    const project = db.put(
      "projects",
      {
        ...(existing ?? {}),
        ...fields,
        tenant_id: LOCAL_USER_ID,
        template_id: templateId ?? existing?.template_id ?? null,
      },
      !!existing,
    );
    const documents: string[] = [];
    const assistantIds: string[] = [];
    for (const { sources, model: _model, ...fields } of assistants) {
      const assistant = db.put("assistants", {
        ...fields,
        tenant_id: LOCAL_USER_ID,
        project_id: project.id,
        model_id: null,
      });
      assistantIds.push(assistant.id);
      for (const url of sources)
        documents.push(registerWebSource(db, assistant.id, url).id);
    }
    return { project, documents, assistantIds };
  });
  result.assistantIds.forEach((id) => db.syncKnowledgeFiles(id));
  return result;
}

export function localAssistantSources(
  db: LocalDatabase,
  assistantId: string,
): string[] {
  return db
    .rows("documents")
    .filter((d) => d.assistant_id === assistantId && d.source_url)
    .map((d) => d.source_url);
}
