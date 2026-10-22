import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runResearchWorkflow } from "../src/lib/local/research-workflow";
import {
  researchSettingsSchema,
  withinWebsite,
  publicWebURL,
} from "../src/lib/research";
import {
  sourceWorkflowDecision,
  publicSearchQuery,
} from "../src/lib/research-policy";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { retrieveAssistantSources } from "../src/lib/local/assistant-research";
import {
  isPublicAddress,
  validatePublicDestination,
} from "../src/lib/local/public-web";
import type { Source } from "../src/lib/catalog";
const source: Source = {
  id: "local",
  document_id: "doc",
  title: "Private document",
  content: "Local scheduling constraint",
  position: 0,
  similarity: 1,
};
const page = {
  url: "https://example.org/docs/",
  title: "Public page",
  content: "Partial public information.",
  links: [] as string[],
  fetchedAt: new Date().toISOString(),
};
const partial = {
  coverage: "partial" as const,
  uncertain: false,
  needsFreshness: false,
};
const sufficient = { ...partial, coverage: "sufficient" as const };
function fixture(advanced = true) {
  const calls: string[] = [],
    events: any[] = [];
  const options = {
    settings: researchSettingsSchema.parse({
      version: 2,
      advancedWebResearch: advanced,
      websites: [{ url: page.url, scope: "section" }],
    }),
    assistantId: "assistant",
    question: "public astronomy facts",
    modelId: "ollama/model",
    sources: [source],
    signal: new AbortController().signal,
    emit: (event: any) => {
      events.push(event);
    },
  };
  const deps: NonNullable<Parameters<typeof runResearchWorkflow>[1]> = {
    features: () => ({ advancedReasoning: true, advancedWebResearch: true }),
    assess: async () => {
      calls.push("assess");
      return partial;
    },
    read: async () => {
      calls.push("read");
      return page;
    },
    research: async () => {
      calls.push("web");
      return {
        version: 1,
        status: "complete",
        evidence: [{ ...page, url: "https://example.net/" }],
        missing: [],
        searches: 1,
        pages: 1,
      };
    },
    validate: async () => ({
      url: new URL(page.url),
      address: { address: "93.184.216.34", family: 4 },
    }),
  };
  return { options, deps, calls, events };
}
test("standard workflow always consults configured websites when local coverage is incomplete, without either Beta", async () => {
  const f = fixture(false);
  f.deps.features = () => ({
    advancedReasoning: false,
    advancedWebResearch: false,
  });
  const result = await runResearchWorkflow(f.options, f.deps);
  assert.deepEqual(f.calls, ["read"]);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].id, "local");
});
test("deterministic local coverage avoids website requests without Docker, while fresh information forces configured consultation", async () => {
  const f = fixture(false);
  f.deps.features = () => ({
    advancedReasoning: false,
    advancedWebResearch: false,
  });
  f.options.sources = [
    { ...source, content: "Public astronomy facts are explained here." },
  ];
  await runResearchWorkflow(f.options, f.deps);
  assert.deepEqual(f.calls, []);
  f.options.question = "latest public astronomy facts";
  await runResearchWorkflow(f.options, f.deps);
  assert.deepEqual(f.calls, ["read"]);
});
test("greetings and explicit local-only requests never trigger website or generic Internet requests", async () => {
  for (const question of [
    "hello!",
    "grazie",
    "Use only local documents for astronomy facts",
    "Usa solo documenti per astronomy facts",
  ]) {
    const f = fixture();
    f.options.question = question;
    await runResearchWorkflow(f.options, f.deps);
    assert(!f.calls.includes("read"));
    assert(!f.calls.includes("web"));
  }
});
test("standard consultation precedes optional reasoning and web fallback, preserving all source order and citations", async () => {
  const f = fixture();
  const result = await runResearchWorkflow(f.options, f.deps);
  assert.deepEqual(f.calls, ["read", "assess", "web", "assess"]);
  assert.deepEqual(
    result.sources.map((s) => s.kind || "document"),
    ["document", "website", "web"],
  );
  assert.equal(f.events.at(-1).type, "research");
});
test("assistant OFF and global OFF independently prevent arbitrary Internet search", async () => {
  for (const assistantEnabled of [false, true]) {
    const f = fixture(assistantEnabled);
    f.deps.features = () => ({
      advancedReasoning: false,
      advancedWebResearch: !assistantEnabled,
    });
    await runResearchWorkflow(f.options, f.deps);
    assert.deepEqual(f.calls, ["read"]);
  }
});
test("reasoning is independent of assistant discovery; web still works when reasoning is off or fails", async () => {
  const reasoning = fixture(false);
  await runResearchWorkflow(reasoning.options, reasoning.deps);
  assert(reasoning.calls.includes("assess"));
  assert(!reasoning.calls.includes("web"));
  for (const enabled of [false, true]) {
    const f = fixture();
    f.deps.features = () => ({
      advancedReasoning: enabled,
      advancedWebResearch: true,
    });
    f.deps.assess = async () => {
      throw Error("offline");
    };
    const result = await runResearchWorkflow(f.options, f.deps);
    assert(f.calls.includes("web"));
    assert.equal(result.sources.length, 3);
  }
});
test("sufficient reasoning stops generic search after standard source consultation", async () => {
  const f = fixture();
  f.deps.assess = async () => sufficient;
  await runResearchWorkflow(f.options, f.deps);
  assert(f.calls.includes("read"));
  assert(!f.calls.includes("web"));
});
test("Docker/service failures and partial discovery retain document and website evidence with warnings", async () => {
  const f = fixture();
  f.deps.research = async () => {
    throw Error("Docker stopped");
  };
  const result = await runResearchWorkflow(f.options, f.deps);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[1].url, page.url);
  assert(result.warnings.length);
  const g = fixture();
  g.deps.research = async () => ({
    version: 1,
    status: "partial",
    evidence: [],
    missing: ["missing fact"],
    searches: 1,
    pages: 1,
  });
  const partialResult = await runResearchWorkflow(g.options, g.deps);
  assert.deepEqual(partialResult.missing, ["missing fact"]);
  assert(partialResult.warnings.some((w) => w.includes("partial")));
});
test("bounded one-hop section crawl stays within configured paths and reserves optional discovery budget", async () => {
  const f = fixture();
  f.options.settings.maxPages = 3;
  f.deps.read = async () => ({
    ...page,
    links: [
      "https://example.org/docs/a",
      "https://example.org/elsewhere",
      "https://example.org/docs/b",
    ],
  });
  let remaining = 0;
  f.deps.research = async (_q, _m, settings) => {
    remaining = settings.maxPages;
    return {
      version: 1,
      status: "complete",
      evidence: [],
      missing: [],
      searches: 1,
      pages: 0,
    };
  };
  const result = await runResearchWorkflow(f.options, f.deps);
  assert.equal(remaining, 1);
  assert(result.warnings.some((w) => w.includes("budget")));
});
test("invalid generic evidence is excluded without losing standard sources; cancellation propagates", async () => {
  const f = fixture();
  f.deps.validate = async () => {
    throw Error("private IP");
  };
  const result = await runResearchWorkflow(f.options, f.deps);
  assert.equal(result.sources.length, 2);
  assert(result.warnings.some((w) => w.includes("excluded")));
  const c = new AbortController();
  c.abort();
  f.options.signal = c.signal;
  await assert.rejects(runResearchWorkflow(f.options, f.deps));
});
test("legacy migration removes exclusive modes without granting Beta or new website consent", async () => {
  for (const mode of ["documents", "sites", "web"] as const) {
    const settings = researchSettingsSchema.parse({
      mode,
      websites: [{ url: page.url, scope: "section" }],
      maxPages: 3,
    });
    assert.equal(settings.version, 2);
    assert.equal(settings.advancedWebResearch, false);
    assert(!("mode" in settings));
    assert.equal(settings.maxPages, 3);
    assert.equal(settings.websitesConfirmed, mode !== "documents");
    const f = fixture();
    f.options.settings = settings;
    f.deps.features = () => ({
      advancedReasoning: false,
      advancedWebResearch: true,
    });
    const result = await runResearchWorkflow(f.options, f.deps);
    assert.equal(f.calls.includes("read"), mode !== "documents");
    assert(!f.calls.includes("web"));
    if (mode === "web")
      assert(result.warnings.some((w) => w.includes("migrated")));
    if (mode === "documents") {
      assert(result.warnings.some((w) => w.includes("Confirm")));
      f.options.settings.websitesConfirmed = true;
      await runResearchWorkflow(f.options, f.deps);
      assert(f.calls.includes("read"));
    }
  }
});
test("privacy: external query contains only the current public question and never documents, source titles or history", async () => {
  const f = fixture();
  let query = "";
  f.options.sources = [
    {
      ...source,
      title: "INTERNAL-SECRET",
      content: "Confidential merger amount EUR 987654321",
    },
  ];
  f.deps.research = async (q) => {
    query = q;
    return {
      version: 1,
      status: "complete",
      evidence: [],
      missing: [],
      searches: 1,
      pages: 0,
    };
  };
  await runResearchWorkflow(f.options, f.deps);
  assert.equal(query, f.options.question);
  assert(!query.includes("SECRET"));
  assert(!query.includes("987654321"));
  for (const question of [
    "my private plan",
    "find client@example.com",
    "call +39 345 123 4567",
    "local scheduling constraint",
    "find invoice details",
  ])
    assert.equal(publicSearchQuery(question, [source]), null);
  assert.equal(
    publicSearchQuery("lookup INV-7742 prices", [
      { ...source, content: "Reference INV-7742" },
    ]),
    null,
  );
  assert.equal(
    publicSearchQuery("latest Mario Rossi project", [
      { ...source, content: "Customer Mario Rossi" },
    ]),
    null,
  );
  f.options.question = "my confidential project";
  f.calls.length = 0;
  const result = await runResearchWorkflow(f.options, f.deps);
  assert(!f.calls.includes("web"));
  assert(result.warnings.some((w) => w.includes("privacy")));
});
test("local retrieval works for every saved legacy mode and isolates assistant documents even without embeddings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "siaas-unified-"));
  const db = new LocalDatabase(directory);
  try {
    const project = db.put("projects", {
      tenant_id: LOCAL_USER_ID,
      name: "Keep",
    });
    const assistants = ["documents", "sites", "web"].map((mode) =>
      db.put("assistants", {
        tenant_id: LOCAL_USER_ID,
        project_id: project.id,
        name: mode,
        research: { mode, websites: [{ url: page.url, scope: "page" }] },
      }),
    );
    for (const a of assistants) {
      const d = db.put("documents", {
        tenant_id: LOCAL_USER_ID,
        assistant_id: a.id,
        title: a.name,
        status: "ready",
      });
      db.put("document_chunks", {
        tenant_id: LOCAL_USER_ID,
        assistant_id: a.id,
        document_id: d.id,
        content: "Astronomy explains star formation",
        position: 0,
      });
      const result = await retrieveAssistantSources({
        db,
        assistantId: a.id,
        question: "star formation",
        modelId: "ollama/small",
        embeddingProfile: null,
        signal: new AbortController().signal,
        emit() {},
      });
      assert.equal(result.length, 1);
      assert.equal(result[0].title, a.name);
    }
    const reopened = new LocalDatabase(directory);
    try {
      for (const a of assistants) {
        const saved = reopened.get("assistants", a.id)!;
        assert.equal(saved.research.version, 2);
        assert.equal(saved.research.advancedWebResearch, false);
        assert.equal(saved.research.websites.length, 1);
      }
    } finally {
      reopened.close();
    }
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("URL policy enforces exact origins, paths, credentials, ports and encoded boundaries", async () => {
  const site = { url: "https://example.org/docs", scope: "section" as const };
  assert(withinWebsite("https://example.org/docs/a", site));
  for (const url of [
    "https://example.org/docstuff",
    "https://example.org/docs/../other",
    "https://example.org/docs/%2f../other",
    "https://example.org.evil.net/docs",
    "http://example.org/docs",
  ])
    assert(!withinWebsite(url, site), url);
  for (const url of [
    "file:///etc/passwd",
    "https://user:pass@example.org",
    "http://example.org:8080",
    "http://localhost.",
  ])
    assert.throws(() => publicWebURL(url));
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::",
  ])
    assert(!isPublicAddress(ip), ip);
  assert(isPublicAddress("1.1.1.1"));
  assert(isPublicAddress("2606:4700:4700::1111"));
  await assert.rejects(validatePublicDestination("http://127.0.0.1/"));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    validatePublicDestination("https://example.org", undefined, abort.signal),
  );
});
