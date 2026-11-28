import JSZip from "jszip";
import { z } from "zod";
import { fail, HttpError, jsonBody, localWorkspace, uuid } from "@/lib/http";
import {
  inspectSkillArchive,
  maxSkillArchive,
} from "@/lib/local/skill-archive";
import {
  assignSkill,
  enabledSkills,
  installedSkill,
  installSkill,
  projectSkills,
  restoreSkill,
} from "@/lib/local/project-skills";

type Params = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Params) {
  try {
    const { db } = await localWorkspace(req);
    const project = uuid.parse((await params).id),
      query = new URL(req.url).searchParams;
    const id = query.get("id"),
      assistant = query.get("assistant");
    if (!id)
      return Response.json({
        skills: projectSkills(db, project),
        requested: db.get("projects",project)?.requested_tools?.skills ?? [],
        enabled: assistant
          ? enabledSkills(db, project, uuid.parse(assistant)).map((s) => s.id)
          : [],
      });
    const { data } = installedSkill(db, project, uuid.parse(id));
    if (query.get("export") !== "1") return Response.json(data);
    const zip = new JSZip();
    for (const [path, file] of Object.entries(data.files))
      zip.file(data.slug + "/" + path, file, { createFolders: false });
    return new Response(await zip.generateAsync({ type: "arraybuffer" }), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="' + data.slug + '.zip"',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export async function POST(req: Request, { params }: Params) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const project = uuid.parse((await params).id);
    if (db.get("projects", project)?.tenant_id !== tenantId)
      throw new HttpError(404, "Project not found.");
    const input = z
      .discriminatedUnion("op", [
        z
          .object({
            op: z.literal("assign"),
            assistant: uuid,
            id: uuid,
            digest,
            enabled: z.boolean(),
          })
          .strict(),
        z.object({ op: z.literal("restore"), id: uuid, digest }).strict(),
        z.object({ op: z.literal("preview"), archive: z.string() }).strict(),
        z
          .object({
            op: z.literal("install"),
            archive: z.string(),
            digest,
            conflict: z.enum(["keep", "copy", "replace"]),
            expected: digest.optional(),
          })
          .strict(),
      ])
      .parse(await jsonBody(req, Math.ceil((maxSkillArchive * 4) / 3) + 1024));
    if (input.op === "assign") {
      assignSkill(
        db,
        project,
        input.assistant,
        input.id,
        input.digest,
        input.enabled,
      );
      return Response.json({ ok: true });
    }
    if (input.op === "restore") {
      restoreSkill(db, project, input.id, input.digest);
      return Response.json({ ok: true });
    }
    let data;
    try {
      data = await inspectSkillArchive(Buffer.from(input.archive, "base64"));
    } catch {
      throw new HttpError(400, "Invalid Markdown Skill archive.");
    }
    if (input.op === "preview") return Response.json(data);
    if (data.digest !== input.digest)
      throw new HttpError(409, "Skill preview changed.");
    return Response.json({
      id: installSkill(db, project, data, input.conflict, input.expected),
    });
  } catch (e) {
    return fail(e);
  }
}
