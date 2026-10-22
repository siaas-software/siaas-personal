import { z } from "zod";
import { localWorkspace, fail, jsonBody } from "@/lib/http";
import { experimentalFeatureSchema } from "@/lib/experimental";
import { experimentalStatus } from "@/lib/local/research-services";
import { setExperimentalFeature } from "@/lib/local/experimental-features";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    return Response.json(await experimentalStatus(db), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function PATCH(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    const input = z
      .object({ feature: experimentalFeatureSchema, enabled: z.boolean() })
      .strict()
      .parse(await jsonBody(req, 2000));
    const result = await setExperimentalFeature(
      db,
      input.feature,
      input.enabled,
    );
    return Response.json(
      { ...result, ...(await experimentalStatus(db)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
