import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultToolPermissions, parseProjectToolPermissions, requireAllow, resolveToolPermission,
} from "../src/lib/tool-permission-gateway";

const resolve = (capability: string, projectPermissions: unknown = null, registered = true, assistantScopeAllowed = true) =>
  resolveToolPermission({ capability, projectPermissions, registered, assistantScopeAllowed });

test("safe defaults do not auto-approve external writes or media generation", () => {
  assert.equal(resolve("documents.read").decision, "allow");
  assert.equal(resolve("datasets.query").decision, "allow");
  assert.equal(resolve("mcp.write").decision, "ask");
  assert.equal(resolve("media.image.generate").decision, "ask");
  assert.equal(resolve("media.video.generate").decision, "ask");
  assert.equal(resolve("mcp.unknown").decision, "deny");
  assert.equal(defaultToolPermissions().rules.length >= 7, true);
});
test("user project rules override defaults but never manufacture a tool or widen scope", () => {
  const config = parseProjectToolPermissions({ rules: [
    { capability: "documents.read", decision: "deny" },
    { capability: "mcp.write", decision: "allow" },
    { capability: "vendor.my-tool:send", decision: "ask" },
  ] });
  assert.equal(resolve("documents.read", config).decision, "deny");
  assert.equal(resolve("mcp.write", config).decision, "allow");
  assert.equal(resolve("mcp.write", config, false).reason, "unregistered");
  assert.equal(resolve("mcp.write", config, true, false).reason, "assistant-scope");
  assert.equal(resolve("vendor.my-tool:send", config).decision, "ask");
  assert.throws(() => requireAllow(resolve("vendor.my-tool:send", config)), /approval required/);
});
test("immutable restrictions cannot be overridden by a template or user setting", () => {
  for (const capability of ["system.shell", "secrets.read", "permissions.bypass", "workspace.cross-project"])
    assert.deepEqual(resolve(capability, {rules:[{capability,decision:"allow"}]}),
      {decision:"deny",reason:"hard-deny"});
});
test("malformed, duplicated and privilege-confusing rule objects are rejected", () => {
  for (const config of [
    {rules:[{capability:"x",decision:"allow"},{capability:"x",decision:"deny"}]},
    {rules:[{capability:"../file",decision:"allow"}]},
    {rules:[{capability:"x",decision:"ALLOW"}]},
    {rules:[{capability:"x",decision:"ask",trusted:true}]},
    {rules:[], bypass:true},
    {rules:"allow"},
    {rules:[{capability:"documents.read",decision:["allow"]}]},
    {rules:Array.from({length:101}, (_,i)=>({capability:"c"+i,decision:"deny"}))},
  ]) assert.throws(()=>parseProjectToolPermissions(config));
});
