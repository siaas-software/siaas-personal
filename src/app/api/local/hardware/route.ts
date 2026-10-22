import { isDesktop } from "@/lib/runtime";
import { fail } from "@/lib/http";
export async function GET() {
  if (!isDesktop())
    return Response.json(
      { error: "Disponibile nell’app desktop." },
      { status: 404 },
    );
  try {
    const { detectHardware } = await import("@/lib/local/hardware");
    return Response.json(await detectHardware());
  } catch (error) {
    return fail(error);
  }
}
