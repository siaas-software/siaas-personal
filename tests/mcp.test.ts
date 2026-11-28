import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  normalizedTool,
  validateToolArguments,
} from "../src/lib/local/mcp/tools";
import { endpointFetch, remoteEndpoint } from "../src/lib/local/mcp/http";
import { serverConfig } from "../src/lib/local/mcp/client";

test("MCP accepts only supported scalar schemas and explicit argument fields", () => {
  const tool = {
    name: "count",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer", minimum: 1, maximum: 8 } },
      required: ["n"],
    },
  };
  const registered = normalizedTool(tool);
  assert.deepEqual(validateToolArguments(registered, { n: 3 }), { n: 3 });
  for (const args of [{}, { n: 9 }, { n: "3" }, { n: 2, extra: "x" }])
    assert.throws(() => validateToolArguments(registered, args));
  for (const field of [
    { type: "object" },
    { type: "string", pattern: ".*" },
    { type: "integer", minimum: 5, maximum: 1 },
  ])
    assert.throws(() =>
      normalizedTool({
        ...tool,
        inputSchema: { ...tool.inputSchema, properties: { n: field } },
      }),
    );
  assert.equal(
    serverConfig.safeParse({
      transport: "stdio",
      executable: "/tmp/tool",
      sha256: "a".repeat(64),
      args: ["example"],
    }).success,
    false,
  );
});

test("MCP transport rejects redirect, oversized body, unapproved local HTTP and endpoint changes", async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === "/redirect")
      res.writeHead(307, { location: "/elsewhere" }).end();
    else res.end(Buffer.alloc(140000));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = "http://127.0.0.1:" + address.port;
  try {
    assert.throws(() => remoteEndpoint(origin));
    const redirect = remoteEndpoint(origin + "/redirect", true);
    await assert.rejects(
      endpointFetch(redirect)(redirect, { method: "POST" }),
      /redirect/,
    );
    await assert.rejects(
      endpointFetch(redirect)(origin + "/elsewhere", { method: "POST" }),
      /destination/,
    );
    await assert.rejects(
      endpointFetch(redirect, "test-token")(redirect, { method: "POST" }),
      /HTTPS/,
    );
    const large = remoteEndpoint(origin + "/large", true);
    const response = await endpointFetch(large)(large, { method: "POST" });
    await assert.rejects(response.arrayBuffer());
    assert.equal(requests, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
