import { createHash } from "node:crypto";
import { LOCAL_USER_ID } from "../runtime";
import type { TemplateProject } from "../templates";
import { listActions } from "./actions";
import type { LocalDatabase } from "./database";

export function portableTools(db: LocalDatabase, id: string, assistants: string[]): TemplateProject["requested_tools"] {
  const project = db.get("projects", id);
  if (project?.tenant_id !== LOCAL_USER_ID) throw new Error("Project unavailable.");
  const actions = listActions(db).filter(a => project.action_ids?.includes(a.id)).map(actionReference);
  const rules = project.permissions?.rules ?? [];
  const rows = db.sql.prepare(`SELECT s.id, json_extract(s.package,'$.slug') AS name,
    json_extract(s.package,'$.digest') AS digest, a.assistant_id
    FROM project_skills s LEFT JOIN assistant_skills a ON a.skill_id=s.id
    WHERE s.project_id=? ORDER BY s.name,a.assistant_id`).all(id);
  const bySkill = new Map<string,{name:string;digest:string;assistant_indices:number[]}>();
  for (const row of rows) {
    const key = String(row.id);
    const skill = bySkill.get(key) ?? {name:String(row.name), digest:String(row.digest), assistant_indices:[]};
    const index = assistants.indexOf(String(row.assistant_id));
    if (index >= 0) skill.assistant_indices.push(index);
    bySkill.set(key,skill);
  }
  const skills = [...bySkill.values()];
  return actions.length || rules.length || skills.length ? {actions, rules, skills} : project.requested_tools;
}
export function actionReference(action: ReturnType<typeof listActions>[number]) {
  const digest = createHash("sha256").update(JSON.stringify([action.kind,action.name,action.markdown,action.capability??null])).digest("hex");
  return {name:action.name,digest};
}
