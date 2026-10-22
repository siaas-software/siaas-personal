import { localWorkspace, fail, HttpError } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    if (!isDesktop())
      throw new HttpError(404, "Overview è disponibile nell’app desktop.");
    await localWorkspace(req);
    const [{ overviewReader }, { localDatabase }] = await Promise.all([
      import("@/lib/local/overview"),
      import("@/lib/local/database"),
    ]);
    return Response.json(await overviewReader().read(localDatabase()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
