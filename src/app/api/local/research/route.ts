import { localWorkspace, fail, HttpError } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
import { researchHealth } from "@/lib/local/research-services";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    if (!isDesktop())
      throw new HttpError(404, "Disponibile solo nell’app locale.");
    await localWorkspace(req);
    return Response.json(await researchHealth(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
