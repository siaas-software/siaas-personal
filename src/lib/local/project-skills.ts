import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "./database";
import { LOCAL_USER_ID } from "../runtime";
import { ActionError } from "../actions";
import type { inspectSkillArchive } from "./skill-archive";

type Package = Awaited<ReturnType<typeof inspectSkillArchive>>;
type Skill = {
  id: string;
  name: string;
  package: string;
  previous: string | null;
};
function invalidate(db: LocalDatabase, project: string) {
  db.sql
    .prepare(
      "INSERT INTO approval_revisions VALUES(?,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1",
    )
    .run(project);
}
function owned(db: LocalDatabase, project: string, assistant?: string) {
  if (db.get("projects", project)?.tenant_id !== LOCAL_USER_ID)
    throw new ActionError(404, "Project not found.");
  if (assistant) {
    const row = db.get("assistants", assistant);
    if (row?.tenant_id !== LOCAL_USER_ID || row.project_id !== project)
      throw new ActionError(404, "Assistant not found.");
  }
}

export function projectSkills(db: LocalDatabase, project: string) {
  owned(db, project);
  const skills = db.sql
    .prepare(
      "SELECT id,name,package,previous IS NOT NULL AS recoverable FROM project_skills WHERE project_id=? ORDER BY name",
    )
    .all(project);
  return skills.map((s) => {
    const data: Package = JSON.parse(String(s.package));
    return {
      id: String(s.id),
      name: String(s.name),
      description: data.description,
      digest: data.digest,
      version: data.version,
      recoverable: Boolean(s.recoverable),
      provenance: "local-import",
    };
  });
}
export function installedSkill(db: LocalDatabase, project: string, id: string) {
  owned(db, project);
  const row = db.sql
    .prepare("SELECT * FROM project_skills WHERE project_id=? AND id=?")
    .get(project, id) as Skill | undefined;
  if (!row) throw new ActionError(404, "Skill not found.");
  return { row, data: JSON.parse(row.package) as Package };
}
export function installSkill(
  db: LocalDatabase,
  project: string,
  data: Package,
  conflict: "keep" | "copy" | "replace",
  expected?: string,
) {
  return db.transaction(() => {
    owned(db, project);
    const existing = db.sql
      .prepare(
        "SELECT id,package FROM project_skills WHERE project_id=? AND name=?",
      )
      .get(project, data.slug);
    if (existing && conflict === "keep") return String(existing.id);
    if (existing && conflict === "replace") {
      if (JSON.parse(String(existing.package)).digest !== expected)
        throw new ActionError(409, "Review the current Skill first.");
      db.sql
        .prepare(
          "UPDATE project_skills SET previous=package,package=? WHERE id=?",
        )
        .run(JSON.stringify(data), existing.id);
      db.sql
        .prepare("DELETE FROM assistant_skills WHERE skill_id=?")
        .run(existing.id);
      invalidate(db, project);
      return String(existing.id);
    }
    if (expected && !existing) throw new ActionError(409, "Skill changed.");
    const id = randomUUID();
    const name = existing ? data.slug + "-" + id : data.slug;
    db.sql
      .prepare(
        "INSERT INTO project_skills(id,project_id,name,package) VALUES(?,?,?,?)",
      )
      .run(id, project, name, JSON.stringify(data));
    return id;
  });
}
export function restoreSkill(
  db: LocalDatabase,
  project: string,
  id: string,
  digest: string,
) {
  db.transaction(() => {
    const { row, data } = installedSkill(db, project, id);
    if (!row.previous || data.digest !== digest)
      throw new ActionError(409, "Skill changed.");
    db.sql
      .prepare(
        "UPDATE project_skills SET package=previous,previous=NULL WHERE id=?",
      )
      .run(id);
    db.sql.prepare("DELETE FROM assistant_skills WHERE skill_id=?").run(id);
    invalidate(db, project);
  });
}
export function assignSkill(
  db: LocalDatabase,
  project: string,
  assistant: string,
  id: string,
  digest: string,
  enabled: boolean,
) {
  db.transaction(() => {
    owned(db, project, assistant);
    const { data } = installedSkill(db, project, id);
    if (data.digest !== digest)
      throw new ActionError(409, "Review the current Skill first.");
    if (enabled)
      db.sql
        .prepare("INSERT OR IGNORE INTO assistant_skills VALUES(?,?)")
        .run(assistant, id);
    else
      db.sql
        .prepare(
          "DELETE FROM assistant_skills WHERE assistant_id=? AND skill_id=?",
        )
        .run(assistant, id);
    invalidate(db, project);
  });
}
export function enabledSkills(
  db: LocalDatabase,
  project: string,
  assistant: string,
) {
  owned(db, project, assistant);
  return db.sql
    .prepare(
      "SELECT s.id,s.name,s.package FROM project_skills s JOIN assistant_skills a ON a.skill_id=s.id WHERE s.project_id=? AND a.assistant_id=? ORDER BY s.name",
    )
    .all(project, assistant)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      instructions: (JSON.parse(String(row.package)) as Package).instructions,
    }));
}
