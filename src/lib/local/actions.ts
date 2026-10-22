import { randomUUID } from "node:crypto";
import {
  BUILTIN_ACTIONS,
  ActionError,
  actionNameSchema,
  actionMarkdownSchema,
  normalizedActionName,
  type ActionSkill,
} from "../actions";
import { LOCAL_USER_ID } from "../runtime";
import type { LocalDatabase } from "./database";

export function listActions(db: LocalDatabase): ActionSkill[] {
  const custom = db
    .rows("actions")
    .filter((row) => row.tenant_id === LOCAL_USER_ID);
  return [
    ...BUILTIN_ACTIONS,
    ...custom
      .map((row) => ({ ...row, kind: "custom" }) as ActionSkill)
      .sort(
        (a, b) =>
          (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
          a.id.localeCompare(b.id),
      ),
  ];
}
export function getAction(db: LocalDatabase, id: string): ActionSkill {
  const action = listActions(db).find((item) => item.id === id);
  if (!action)
    throw new ActionError(
      404,
      "Action not found. Refresh Actions and try again. / Action non trovata.",
    );
  return action;
}
export function validateActionName(
  db: LocalDatabase,
  name: string,
  id?: string,
) {
  const result = actionNameSchema.safeParse(name);
  if (!result.success)
    throw new ActionError(
      400,
      "Enter an Action name (1–80 characters, one line). / Inserisci un nome valido.",
    );
  if (
    listActions(db).some(
      (a) =>
        a.id !== id &&
        normalizedActionName(a.name) === normalizedActionName(result.data),
    )
  )
    throw new ActionError(
      409,
      "An Action already has this name. Choose another. / Nome già utilizzato.",
    );
  return result.data;
}
export function editableAction(db: LocalDatabase, id: string) {
  const action = getAction(db, id);
  if (action.kind === "builtin")
    throw new ActionError(
      403,
      "Built-in Actions are read-only. / Le Actions integrate sono di sola lettura.",
    );
  return action;
}
export function saveAction(
  db: LocalDatabase,
  input: { name: string; markdown: string; id?: string; updated_at?: string },
): ActionSkill {
  return db.transaction(() => {
    const current = input.id ? editableAction(db, input.id) : null;
    if (current && current.updated_at !== input.updated_at)
      throw new ActionError(
        409,
        "This Action changed. Reopen it before editing. / Action modificata: riaprila.",
      );
    const name = validateActionName(db, input.name, input.id);
    const parsed = actionMarkdownSchema.safeParse(input.markdown);
    if (!parsed.success)
      throw new ActionError(400, parsed.error.issues[0].message);
    const now = new Date(
      Math.max(Date.now(), Date.parse(current?.updated_at ?? "") + 1 || 0),
    ).toISOString();
    return db.put(
      "actions",
      {
        id: current?.id ?? randomUUID(),
        tenant_id: LOCAL_USER_ID,
        name,
        markdown: parsed.data,
        kind: "custom",
        created_at: current?.created_at ?? now,
        updated_at: now,
      },
      !!current,
    ) as ActionSkill;
  });
}
export function deleteAction(db: LocalDatabase, id: string) {
  db.transaction(() => {
    editableAction(db, id);
    db.sql
      .prepare("DELETE FROM actions WHERE id=? AND tenant_id=?")
      .run(id, LOCAL_USER_ID);
  });
}
