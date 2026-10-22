import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { migrateExperimentalFeatures } from "../src/lib/experimental";
import {
  experimentalPreferences,
  requireFeature,
  setExperimentalFeature,
} from "../src/lib/local/experimental-features";
import {
  serviceRequest,
  experimentalStatus,
  assertAssistantResearchChange,
} from "../src/lib/local/research-services";
const ready = { ready: true, reason: "ready", message: "", help: "" };
const stopped = { ...ready, ready: false, reason: "engine_unavailable" };
async function database(fn: (db: LocalDatabase) => Promise<void>) {
  const path = mkdtempSync(join(tmpdir(), "siaas-beta-"));
  const db = new LocalDatabase(path);
  try {
    await fn(db);
  } finally {
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
}
test("new and legacy configurations default to OFF; legacy modes, endpoints and malformed settings never grant consent", () => {
  for (const value of [
    undefined,
    {},
    { mode: "web", laya: "local", morphic: "local" },
    { version: 2, advancedReasoning: true },
    { advancedReasoning: "true" },
  ]) {
    assert.deepEqual(migrateExperimentalFeatures(value), {
      version: 1,
      advancedReasoning: false,
      advancedWebResearch: false,
    });
  }
});
test("migration and restart preserve projects, assistants, selected websites, messages and other settings", async () =>
  database(async (db) => {
    const workspace = db.get("workspaces", LOCAL_USER_ID)!;
    delete workspace.experimental_features;
    db.put(
      "workspaces",
      { ...workspace, custom_setting: { preserved: true } },
      true,
    );
    const project = db.put("projects", {
      name: "Existing",
      tenant_id: LOCAL_USER_ID,
    });
    const assistant = db.put("assistants", {
      name: "Assistant",
      tenant_id: LOCAL_USER_ID,
      project_id: project.id,
      model_id: "ollama/test:8b",
      research: {
        mode: "web",
        websites: [{ url: "https://example.org", scope: "page" }],
      },
    });
    const conversation = db.put("conversations", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistant.id,
      title: "History",
    });
    const message = db.put("messages", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistant.id,
      conversation_id: conversation.id,
      content: "Keep",
      sources: [{ url: "https://example.org" }],
    });
    const reopened = new LocalDatabase(db.directory);
    try {
      assert.equal(
        experimentalPreferences(reopened).advancedWebResearch,
        false,
      );
      const migrated = reopened.get("assistants", assistant.id)!;
      assert.deepEqual(
        { ...migrated, research: undefined },
        { ...assistant, research: undefined },
      );
      assert.deepEqual(migrated.research.websites, assistant.research.websites);
      assert.equal(migrated.research.advancedWebResearch, false);
      assert.equal(migrated.research.migrationNotice, "legacy_web");
      assert.deepEqual(reopened.get("messages", message.id), message);
      assert.deepEqual(
        reopened.get("workspaces", LOCAL_USER_ID)!.custom_setting,
        { preserved: true },
      );
    } finally {
      reopened.close();
    }
  }));
test("backend rejects enabling either feature without prerequisites and never starts services or persists an enabled preference", async () =>
  database(async (db) => {
    for (const feature of [
      "advancedReasoning",
      "advancedWebResearch",
    ] as const) {
      for (const reason of [
        "not_installed",
        "compose_unavailable",
        "inaccessible",
        "engine_unavailable",
        "unsupported_engine",
      ]) {
        await assert.rejects(
          setExperimentalFeature(db, feature, true, {
            detect: async () => ({ ...stopped, reason }),
            manage: async () => assert.fail("must not start"),
          }),
        );
        assert.equal(experimentalPreferences(db)[feature], false);
      }
    }
  }));
test("features activate and stop independently; Docker recovery never enables the other preference", async () =>
  database(async (db) => {
    const calls: unknown[] = [];
    const deps = {
      detect: async () => ready,
      manage: async (...args: unknown[]) => {
        calls.push(args);
      },
    };
    await setExperimentalFeature(db, "advancedWebResearch", true, deps);
    assert.equal(experimentalPreferences(db).advancedReasoning, false);
    await setExperimentalFeature(db, "advancedReasoning", true, deps);
    await setExperimentalFeature(db, "advancedWebResearch", false, deps);
    assert.deepEqual(experimentalPreferences(db), {
      version: 1,
      advancedReasoning: true,
      advancedWebResearch: false,
    });
    assert.deepEqual(calls, [
      ["advancedWebResearch", "start"],
      ["advancedReasoning", "start"],
      ["advancedWebResearch", "stop"],
    ]);
    await assert.rejects(
      requireFeature("advancedReasoning", db, async () => stopped),
    );
    assert.equal(experimentalPreferences(db).advancedReasoning, true);
    await requireFeature("advancedReasoning", db, async () => ready);
    await assert.rejects(
      requireFeature("advancedWebResearch", db, async () => ready),
    );
  }));
test("failed start and Docker loss during startup never persist a new activation; revocation succeeds with pending cleanup", async () =>
  database(async (db) => {
    await assert.rejects(
      setExperimentalFeature(db, "advancedReasoning", true, {
        detect: async () => ready,
        manage: async () => {
          throw Error("build failed");
        },
      }),
    );
    let checks = 0;
    await assert.rejects(
      setExperimentalFeature(db, "advancedReasoning", true, {
        detect: async () => (++checks === 1 ? ready : stopped),
        manage: async () => {},
      }),
    );
    assert.equal(experimentalPreferences(db).advancedReasoning, false);
    await setExperimentalFeature(db, "advancedReasoning", true, {
      detect: async () => ready,
      manage: async () => {},
    });
    const result = await setExperimentalFeature(
      db,
      "advancedReasoning",
      false,
      {
        detect: async () => assert.fail("revocation needs no Docker"),
        manage: async () => {
          throw Error("stopped");
        },
      },
    );
    assert(result.cleanupPending);
    assert.equal(
      db.get("workspaces", LOCAL_USER_ID)!.experimental_cleanup_pending
        .advancedReasoning,
      true,
    );
    assert.equal(experimentalPreferences(db).advancedReasoning, false);
  }));
test("backend blocks new assistant opt-in while preserving existing consent for unrelated offline edits", async () =>
  database(async (db) => {
    await assert.rejects(
      assertAssistantResearchChange(
        {},
        { version: 2, advancedWebResearch: true },
        db,
      ),
    );
    await assertAssistantResearchChange(
      { version: 2, advancedWebResearch: true },
      { version: 2, advancedWebResearch: true },
      db,
    );
    await assertAssistantResearchChange(
      { version: 2, advancedWebResearch: true },
      { version: 2, advancedWebResearch: false },
      db,
    );
  }));
test("disabled engine requests are blocked before any health or private evidence network request", async () => {
  const path = mkdtempSync(join(tmpdir(), "siaas-beta-network-"));
  const old = process.env.SIAAS_DATA_DIR;
  const original = global.fetch;
  process.env.SIAAS_DATA_DIR = path;
  global.fetch = async () =>
    assert.fail("Disabled engines must receive no request");
  try {
    await assert.rejects(
      serviceRequest("laya", "/assess", AbortSignal.timeout(1000), {
        evidence: "private",
      }),
    );
    await assert.rejects(
      serviceRequest("morphic", "/research", AbortSignal.timeout(1000), {
        query: "private",
      }),
    );
  } finally {
    global.fetch = original;
    if (old === undefined) delete process.env.SIAAS_DATA_DIR;
    else process.env.SIAAS_DATA_DIR = old;
  }
});
test("lifecycle stops only the selected owned service and never deletes volumes or unrelated containers", () => {
  const script = readFileSync(
    new URL("../scripts/research-services.mjs", import.meta.url),
    "utf8",
  );
  assert(script.includes('feature === "reasoning" ? "laya" : "searxng"'));
  assert(!/"down"|"prune"|"--volumes"/.test(script));
});

test("status never probes disabled engines and distinguishes Docker availability from saved consent", async () =>
  database(async (db) => {
    const deps = {
      detect: async () => ready,
      configured: () => true,
      health: async () => assert.fail("no disabled engine health call"),
    };
    const disabled = await experimentalStatus(db, deps);
    assert.equal(disabled.services.advancedReasoning.state, "disabled");
    assert.equal(disabled.services.advancedWebResearch.available, false);
    assert.equal(experimentalPreferences(db).advancedReasoning, false);
    await setExperimentalFeature(db, "advancedReasoning", true, {
      detect: async () => ready,
      manage: async () => {},
    });
    const offline = await experimentalStatus(db, {
      ...deps,
      detect: async () => stopped,
    });
    assert.equal(offline.preferences.advancedReasoning, true);
    assert.equal(
      offline.services.advancedReasoning.state,
      "docker_unavailable",
    );
    const warming = await experimentalStatus(db, {
      ...deps,
      health: async () => {
        throw Error("loading");
      },
    });
    assert.equal(warming.services.advancedReasoning.state, "starting");
    const healthy = await experimentalStatus(db, {
      ...deps,
      health: async () => ({ ok: true }),
    });
    assert.equal(healthy.services.advancedReasoning.state, "ready");
    const failure = await experimentalStatus(db, {
      ...deps,
      health: async () => ({ ok: false }),
    });
    assert.equal(failure.services.advancedReasoning.state, "error");
    assert.equal(failure.services.advancedWebResearch.state, "disabled");
    assert.equal(experimentalPreferences(db).advancedReasoning, true);
  }));
