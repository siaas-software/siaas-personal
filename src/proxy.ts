import { isDesktop } from "./lib/runtime";
import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  if (!isDesktop()) return response;
  const expected = process.env.SIAAS_DESKTOP_KEY;
  const host = request.headers.get("host");
  if (!process.env.SIAAS_DESKTOP_ORIGIN || !expected || expected.length < 32 ||
      request.headers.get("x-siaas-desktop-key") !== expected ||
      host !== new URL(process.env.SIAAS_DESKTOP_ORIGIN).host)
    return NextResponse.json({ error: "Open SIAAS Personal from the desktop application." }, { status: 403 });
  if (request.headers.get("origin") && request.headers.get("origin") !== process.env.SIAAS_DESKTOP_ORIGIN)
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
