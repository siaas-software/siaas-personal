import { readLicenseDocuments } from "@/lib/licenses";
import { isDesktop } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDesktop())
    return Response.json(
      { error: "Open SIAAS Personal from the desktop application." },
      { status: 403 },
    );
  try {
    return Response.json(await readLicenseDocuments(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Local license files are unavailable. Repair the application installation.",
      },
      { status: 500 },
    );
  }
}
