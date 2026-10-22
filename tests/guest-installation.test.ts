import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { GET } from "../src/app/api/desktop/downloads/route";

test("guest desktop API retains host, origin and session-key protection", async () => {
  const previous = { ...process.env };
  try {
    process.env.SIAAS_RUNTIME = "desktop";
    delete process.env.VERCEL;
    process.env.SIAAS_DESKTOP_DEV = "0";
    process.env.SIAAS_DESKTOP_KEY = "k".repeat(64);
    process.env.SIAAS_DESKTOP_ORIGIN = "http://127.0.0.1:3100";
    const headers = {
      host: "127.0.0.1:3100",
      "x-siaas-desktop-key": "k".repeat(64),
    };
    const request = (h: Record<string, string>) =>
      new NextRequest("http://127.0.0.1:3100/api/workspace", { headers: h });
    assert.equal((await proxy(request(headers))).status, 200);
    assert.equal((await proxy(request({ host: headers.host }))).status, 403);
    assert.equal(
      (await proxy(request({ ...headers, host: "evil.test" }))).status,
      403,
    );
    assert.equal(
      (await proxy(request({ ...headers, origin: "https://evil.test" })))
        .status,
      403,
    );
    assert.equal(
      (
        await GET(
          new Request(
            "http://127.0.0.1:3100/api/desktop/downloads?platform=win32&arch=x64",
          ),
        )
      ).status,
      404,
    );
    delete process.env.SIAAS_RUNTIME;
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in previous)) delete process.env[k];
    Object.assign(process.env, previous);
  }
});

test("public installer exposes only a verified package, pins version, handles missing releases and rejects unsupported targets", async () => {
  const original = global.fetch,
    oldToken = process.env.SIAAS_RELEASE_GITHUB_TOKEN;
  delete process.env.SIAAS_RELEASE_GITHUB_TOKEN;
  let missing = false;
  const name = "SIAAS-Personal-1.3.0-win-x64.exe",
    hash = Buffer.alloc(64, 1).toString("base64");
  global.fetch = async (input, options) => {
    assert.equal(new Headers(options?.headers).get("authorization"), null);
    const url = String(input);
    if (url.includes("/releases/assets/1"))
      return Response.json({
        version: "1.3.0",
        files: [{ url: name, sha512: hash, size: 42 }],
        releaseDate: "2026-10-13",
      });
    if (url.includes("/releases/assets/2"))
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://release-assets.githubusercontent.com/test.exe?ticket=short-lived",
        },
      });
    return missing
      ? new Response(null, { status: 404 })
      : Response.json({
          tag_name: "v1.3.0",
          draft: false,
          prerelease: false,
          assets: [
            { id: 1, name: "update-win32-x64.json", size: 400 },
            { id: 2, name, size: 42 },
          ],
        });
  };
  try {
    const base =
      "https://service.test/api/desktop/downloads?platform=win32&arch=x64";
    const response = await GET(new Request(base));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.sha512, Buffer.alloc(64, 1).toString("hex"));
    assert(data.downloadUrl.includes("tag=v1.3.0"));
    assert(!JSON.stringify(data).includes("test-server-only"));
    assert.equal((await GET(new Request(data.downloadUrl))).status, 302);
    assert.equal(
      (await GET(new Request(base.replace("x64", "arm64")))).status,
      400,
    );
    assert.equal(
      (await GET(new Request(base + "&tag=../../private"))).status,
      400,
    );
    missing = true;
    assert.equal((await GET(new Request(base))).status, 404);
  } finally {
    global.fetch = original;
    if (oldToken === undefined) delete process.env.SIAAS_RELEASE_GITHUB_TOKEN;
    else process.env.SIAAS_RELEASE_GITHUB_TOKEN = oldToken;
  }
});
