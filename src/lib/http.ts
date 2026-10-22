import { ActionError } from "./actions";
import { FeatureUnavailableError } from "./local/experimental-features";
import "server-only";
import { isDesktop, LOCAL_USER_ID } from "./runtime";
import { z } from "zod";
import { OllamaError } from "./ollama";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(error: unknown) {
  if (error instanceof FeatureUnavailableError)
    return Response.json(
      {
        error:
          "Optional Beta feature unavailable. Refresh Docker status in Settings > Experimental Features. / Funzionalità Beta opzionale non disponibile. Aggiorna lo stato Docker in Impostazioni > Funzionalità sperimentali.",
        code: error.code,
      },
      { status: 409 },
    );
  if (
    error instanceof HttpError ||
    error instanceof OllamaError ||
    error instanceof ActionError
  )
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json(
      { error: "Controlla i dati inseriti." },
      { status: 400 },
    );
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "database_error",
  );
  return Response.json(
    { error: "Operazione non riuscita. Riprova tra poco." },
    { status: 500 },
  );
}
export async function localWorkspace(request?: Request) {
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const expectedOrigin = isDesktop()
      ? process.env.SIAAS_DESKTOP_ORIGIN
      : new URL(request.url).origin;
    if (!origin || origin !== expectedOrigin)
      throw new HttpError(403, "Origine della richiesta non valida.");
  }
  if (isDesktop()) {
    const { localClient } = await import("./local/database");
    return {
      db: localClient(),
      tenantId: LOCAL_USER_ID,
    };
  }
  throw new HttpError(403, "Open SIAAS Personal from the desktop application.");
}
export async function jsonBody(request: Request, maxBytes = 200_000) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Richiesta vuota.");
  let size = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Richiesta troppo grande.");
    }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export const uuid = z.string().uuid();
