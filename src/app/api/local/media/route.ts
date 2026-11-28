import { fail, jsonBody, localWorkspace } from "@/lib/http";
import { settings, setSettings } from "@/lib/local/media/service";
import { access, constants } from "node:fs/promises";
export async function GET(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    const ffmpeg = await Promise.all(
      ["/usr/bin/ffmpeg", "/usr/bin/ffprobe"].map((p) =>
        access(p, constants.X_OK),
      ),
    ).then(
      () => true,
      () => false,
    );
    return Response.json({ ...settings(db), ffmpeg });
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    setSettings(db, await jsonBody(req, 1024));
    return Response.json(settings(db));
  } catch (e) {
    return fail(e);
  }
}
