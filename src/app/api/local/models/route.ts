import { isLocalModelName } from "@/lib/model-name";
import { isDesktop } from "@/lib/runtime";
import { localWorkspace, fail, HttpError, jsonBody } from "@/lib/http";
import { MODELS, EMBEDDING_MODEL } from "@/lib/catalog";
import { ollamaURL, verifyLocalChatModel } from "@/lib/ollama";
import { isLocalModelId } from "@/lib/model-name";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    if (!isDesktop()) throw new HttpError(404, "Solo desktop.");
    await localWorkspace(req);
    const model = z
      .string()
      .refine(isLocalModelId)
      .parse(new URL(req.url).searchParams.get("model"));
    return Response.json(await verifyLocalChatModel(model), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request) {
  try {
    if (!isDesktop()) throw new HttpError(404, "Solo desktop.");
    await localWorkspace(req);
    const { model } = z
      .object({
        model: z.string().refine(isLocalModelName),
      })
      .parse(await jsonBody(req, 1024));
    const upstream = await fetch(ollamaURL() + "/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      redirect: "error",
      signal: req.signal,
    });
    if (!upstream.ok || !upstream.body)
      throw new HttpError(
        502,
        "Download non avviato. Verifica che Ollama sia aperto.",
      );
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
