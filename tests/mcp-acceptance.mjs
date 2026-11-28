import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/** HTTP test double speaks MCP over a real socket. stdio uses a separate native process. */
export async function checkMcp({
  api,
  project,
  assistant,
  stranger,
  direct,
  until,
  db,
}) {
  const route = "/api/projects/" + project.id + "/mcp";
  let calls = 0;
  const http = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const parts = [];
    for await (const part of req) parts.push(part);
    const msg = JSON.parse(Buffer.concat(parts));
    if (msg.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result;
    if (msg.method === "initialize")
      result = {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "fixture", version: "1" },
        capabilities: { tools: {} },
      };
    else if (msg.method === "tools/list")
      result = {
        tools: [
          {
            name: "echo",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      };
    else if (msg.method === "tools/call") {
      calls++;
      result = {
        content: [
          { type: "text", text: "Fixture echo: " + msg.params.arguments.text },
        ],
      };
    } else {
      res.writeHead(405).end();
      return;
    }
    if (msg.method === "tools/call") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        "event: message\ndata: " +
          JSON.stringify({ id: msg.id, jsonrpc: "2.0", result }) +
          "\n\n",
      );
      // The call must complete while its SSE connection is still open.
      const timer = setTimeout(() => res.end(), 18000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ id: msg.id, jsonrpc: "2.0", result }));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  try {
    const configs = [
      {
        transport: "http",
        endpoint: "http://127.0.0.1:" + http.address().port + "/mcp",
        allowLoopback: true,
      },
    ];
    if (process.env.SIAAS_MCP_FIXTURE_BINARY) {
      const executable = process.env.SIAAS_MCP_FIXTURE_BINARY;
      configs.push({
        transport: "stdio",
        executable,
        sha256: createHash("sha256")
          .update(await readFile(executable))
          .digest("hex"),
      });
    }
    for (const config of configs) {
      const { id } = await api(
        route,
        "POST",
        { op: "save", name: "Fixture " + config.transport, config },
        201,
      );
      await api(route, "POST", { op: "connect", id });
      const server = (await api(route)).servers.find((s) => s.id === id);
      assert.equal(server.status, "connected");
      assert.equal(server.tools.length, 1);
      const tool = server.tools[0],
        command = "/mcp " + id + ' echo {"text":"scoped"}';
      const denied = await direct(assistant, command);
      assert.equal(denied.status, "error");
      await api(
        route,
        "POST",
        {
          op: "assign",
          id,
          assistant: stranger.id,
          name: "echo",
          digest: tool.digest,
          enabled: true,
        },
        404,
      );
      await api(route, "POST", {
        op: "assign",
        id,
        assistant: assistant.id,
        name: "echo",
        digest: tool.digest,
        enabled: true,
      });
      const permissions = "/api/projects/" + project.id + "/permissions";
      await api(permissions, "PUT", {
        rules: [
          { capability: "mcp.write", decision: "deny" },
          { capability: tool.capability, decision: "allow" },
        ],
      });
      assert.equal((await direct(assistant, command)).status, "error");
      const exported = await api("/api/project/export?project=" + project.id);
      const request = exported.project.requested_tools.mcp[0];
      assert.deepEqual(request, {
        server: server.name,
        tool: tool.name,
        digest: tool.digest,
        assistant_indices: [
          exported.project.assistants.findIndex(
            (a) => a.name === assistant.name,
          ),
        ],
      });
      for (const privateValue of [
        id,
        tool.capability,
        config.endpoint ?? config.executable,
      ])
        assert(!JSON.stringify(exported).includes(privateValue));
      const destination = await api(
        "/api/projects",
        "POST",
        { name: "MCP destination" },
        201,
      );
      await api(
        "/api/project/import?project=" + destination.id,
        "POST",
        exported,
        201,
      );
      const local = await api("/api/projects/" + destination.id + "/mcp");
      assert.deepEqual(local.servers, []);
      assert.equal(local.requested.length, 1);
      assert.equal(local.requested[0].matched, false);
      const again = await api("/api/project/export?project=" + destination.id);
      const copied = again.project.requested_tools.mcp[0];
      assert.equal(
        again.project.assistants[copied.assistant_indices[0]].name,
        assistant.name,
      );
      assert.equal(copied.digest, tool.digest);
      await api(permissions, "PUT", { rules: [] });
      const run = direct(assistant, command);
      const approvalRoute = "/api/projects/" + project.id + "/approvals";
      const pending = await until(
        async () => (await api(approvalRoute)).pending[0],
      );
      assert.equal(pending.operation, "mcp_call");
      assert.equal(JSON.parse(pending.parameters).serverId, id);
      await api(approvalRoute, "POST", { id: pending.id, outcome: "approved" });
      const completed = await run;
      assert.equal(completed.status, "complete");
      assert.equal(completed.content, "Fixture echo: scoped");
      const events = db.sql
        .prepare("SELECT details FROM execution_events WHERE trace_id=?")
        .all(pending.traceId);
      assert(!JSON.stringify(events).includes("scoped"));
      const cancelled = direct(assistant, command);
      await until(async () => (await api(approvalRoute)).pending[0]);
      await api(route, "POST", { op: "disconnect", id });
      assert.equal((await cancelled).status, "error");
      assert.equal(
        (await api(route)).servers.find((s) => s.id === id).status,
        "disconnected",
      );
      await api(route, "POST", { op: "remove", id });
      assert.deepEqual(
        (await api(route + "?assistant=" + assistant.id)).assignments,
        {},
      );
      console.log(
        "PASS real MCP " +
          config.transport +
          " discovery, assignment, approval, call, disconnect and revocation through desktop HTTP.",
      );
    }
    assert.equal(calls, 1);
  } finally {
    http.closeAllConnections();
    http.close();
  }
}
