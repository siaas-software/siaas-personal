import { localWorkspace, fail, HttpError, uuid } from "@/lib/http";
import { enabledSkills, projectSkills } from "@/lib/local/project-skills";
import { listActions } from "@/lib/local/actions";
import { generateProjectAgentsMarkdown } from "@/lib/agents-md";
import type { Assistant, Project } from "@/lib/catalog";

/** Read-only dynamic preview; no AGENTS.md file is persisted or imported. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const project = db.get("projects", id) as (Project & { permissions?: unknown; action_ids?: string[] }) | null;
    if (!project || project.tenant_id !== tenantId)
      throw new HttpError(404, "Project not found.");
    const assistants = db.rows("assistants").filter((a) =>
      a.tenant_id === tenantId && a.project_id === id
    ) as Assistant[];
    const markdown = generateProjectAgentsMarkdown({
      name: project.name,
      description: project.description,
      assistants: assistants.map(a=>({
        name:a.name, description:a.description, instructions:a.instructions, skills:enabledSkills(db,id,a.id).map(s => s.name),
      })),
      skills: projectSkills(db,id).map(s => s.name),
      actions: listActions(db).filter(action => project.action_ids?.includes(action.id)),
      permissions: project.permissions,
      orchestration: project.orchestration,
    });
    return Response.json({ markdown }, {headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { return fail(error); }
}
