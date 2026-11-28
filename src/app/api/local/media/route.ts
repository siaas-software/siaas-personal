import { fail, jsonBody, localWorkspace } from "@/lib/http";
import {
  components,
  installComponent,
  componentForm,
} from "@/lib/local/media/generator";
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
    return Response.json({
      ...settings(db),
      ffmpeg,
      components: await components(db.directory),
    });
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

export async function POST(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    await installComponent(
      db.directory,
      componentForm.parse(await jsonBody(req, 8192)),
      AbortSignal.any([req.signal, AbortSignal.timeout(120000)]),
    );
    return Response.json(await components(db.directory));
  } catch (e) {
    return fail(e);
  }
}
