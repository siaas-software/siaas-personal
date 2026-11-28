import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { validatePublicDestination } from "../public-web";

export function remoteEndpoint(input: string, allowLoopback = false) {
  const url = new URL(input);
  if (
    allowLoopback &&
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    Number(url.port) >= 1024 &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
    return url;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "MCP requires a public HTTPS endpoint without credentials, query or fragment.",
    );
  return url;
}

/** Only this exact destination may receive the user's ephemeral bearer credential. */
export function endpointFetch(endpoint: URL, bearer?: string) {
  return async (
    target: URL | string,
    init: RequestInit = {},
  ): Promise<Response> => {
    if (new URL(target).href !== endpoint.href)
      throw new Error("MCP destination changed.");
    const method = init.method ?? "GET";
    // No unsolicited notifications or server-to-client streams in the RC7 tools profile.
    if (method === "GET") return new Response(null, { status: 405 });
    if (
      !["POST", "DELETE"].includes(method) ||
      (init.body != null && typeof init.body !== "string")
    )
      throw new Error("Unsupported MCP request.");
    const signal = AbortSignal.any([
      AbortSignal.timeout(12000),
      ...(init.signal ? [init.signal] : []),
    ]);
    const local =
      endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1";
    const { url, address } = local
      ? { url: endpoint, address: { address: "127.0.0.1", family: 4 } }
      : await validatePublicDestination(endpoint.href, undefined, signal);
    if (local && bearer) throw new Error("Bearer credentials require HTTPS.");
    const headers = new Headers(init.headers);
    const outgoing: Record<string, string> = { "accept-encoding": "identity" };
    for (const name of [
      "content-type",
      "accept",
      "mcp-protocol-version",
      "mcp-session-id",
      "mcp-method",
      "mcp-name",
    ]) {
      const value = headers.get(name);
      if (value) outgoing[name] = value;
    }
    if (bearer) outgoing.authorization = "Bearer " + bearer;
    return new Promise<Response>((resolve, reject) => {
      const pinned = ((
        _host: string,
        options: { all?: boolean },
        cb: Function,
      ) =>
        options.all
          ? cb(null, [address])
          : cb(null, address.address, address.family)) as LookupFunction;
      const request = (local ? http : https).request(
        url,
        { method, headers: outgoing, signal, lookup: pinned, agent: false },
        (res) => {
          const status = res.statusCode ?? 500;
          if (status >= 300 && status < 400) {
            res.destroy();
            reject(new Error("MCP redirect refused."));
            return;
          }
          if (status < 200 || status > 599) {
            res.destroy();
            reject(new Error("Invalid MCP response."));
            return;
          }
          const head = new Headers();
          for (const name of ["content-type", "mcp-session-id"]) {
            const value = res.headers[name];
            if (typeof value === "string") head.set(name, value);
          }
          if (status === 204 || status === 205 || status === 304) {
            res.destroy();
            resolve(new Response(null, { status, headers: head }));
            return;
          }
          let total = 0;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              res.on("data", (part: Buffer) => {
                total += part.length;
                if (total > 131072) {
                  res.destroy(new Error("MCP response too large."));
                  return;
                }
                controller.enqueue(part);
              });
              res.on("end", () => controller.close());
              res.on("error", () =>
                controller.error(new Error("MCP response interrupted.")),
              );
            },
            cancel() {
              res.destroy();
            },
          });
          resolve(new Response(body, { status, headers: head }));
        },
      );
      request.on("error", () =>
        reject(new Error("MCP connection unavailable.")),
      );
      request.end(init.body ?? undefined);
    });
  };
}
