import { localWorkspace, fail, HttpError } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
import { modelCatalog } from "@/lib/model-catalog";
export async function GET(req: Request) {
  try {
    if (!isDesktop()) throw new HttpError(404, "Solo desktop.");
    await localWorkspace(req);
    try {
      return Response.json(
        await modelCatalog(
          new URL(req.url).searchParams.get("refresh") === "1",
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return Response.json(
        {
          ...(await modelCatalog()),
          warning:
            "Aggiornamento non disponibile. Stai usando il catalogo locale.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (error) {
    return fail(error);
  }
}
