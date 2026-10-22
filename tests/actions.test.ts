import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import {
  BUILTIN_ACTIONS,
  actionMarkdownSchema,
  actionRequest,
  actionInvocation,
} from "../src/lib/actions";
import {
  SHORTCUT_ACTIONS,
  shortcutPrompt,
  shortcutDisplayPrompt,
} from "../src/lib/shortcuts";
import {
  listActions,
  getAction,
  saveAction,
  deleteAction,
  validateActionName,
} from "../src/lib/local/actions";
import {
  buildAction,
  builderInputSchema,
  signActionPreview,
  verifyActionPreview,
  BUILDER_SCOPE_MESSAGE,
  BUILDER_UNSUPPORTED_MESSAGE,
} from "../src/lib/local/action-builder";
const markdown = BUILTIN_ACTIONS[1].markdown;
const input = {
  name: "Study summary",
  modelId: "ollama/test:3b",
  messages: [
    {
      role: "user" as const,
      content: "Create an Action that summarizes study notes",
    },
  ],
};
function fixture(
  responses: unknown[],
  options: {
    connected?: boolean;
    installed?: boolean;
    incomplete?: boolean;
    wait?: boolean;
  } = {},
) {
  const calls: Record<string, any>[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    if (options.connected === false) throw new TypeError("offline");
    if (String(url).endsWith("/api/tags"))
      return Response.json({
        models:
          options.installed === false
            ? []
            : [{ name: "test:3b", digest: "a".repeat(64) }],
      });
    if (String(url).endsWith("/api/show"))
      return Response.json({
        capabilities: ["completion"],
        model_info: { "general.parameter_count": 3e9 },
      });
    calls.push(JSON.parse(String(init?.body)));
    if (options.wait)
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        ),
      );
    return Response.json({
      done: !options.incomplete,
      message: { content: JSON.stringify(responses.shift()) },
    });
  }) as typeof fetch;
  return { request, calls };
}
test("migration maps every compatible shortcut exactly; Data Cell retains its native prompt", () => {
  assert.deepEqual(
    BUILTIN_ACTIONS.map((a) => a.id),
    ["builtin:mindmap", "builtin:report", "builtin:flashcards", "builtin:quiz"],
  );
  for (const legacy of SHORTCUT_ACTIONS.filter((a) => a.id !== "table")) {
    const action = BUILTIN_ACTIONS.find(
      (a) => a.id === `builtin:${legacy.id}`,
    )!;
    assert(action.markdown.includes(legacy.task));
    assert(actionMarkdownSchema.safeParse(action.markdown).success);
    assert.equal(
      shortcutDisplayPrompt(shortcutPrompt(legacy.id)),
      `Create ${legacy.label.toLowerCase()} from my knowledge.`,
    );
  }
  assert.equal(
    shortcutDisplayPrompt(shortcutPrompt("table", "Name, price")),
    "Create a data table: Name, price",
  );
});
test("SQLite create/edit/delete, read-only builtins, duplicate names, persistence and migration preservation", () => {
  const dir = mkdtempSync(join(tmpdir(), "siaas-actions-"));
  let db = new LocalDatabase(dir);
  try {
    const project = db.put("projects", {
      tenant_id: LOCAL_USER_ID,
      name: "Existing",
    });
    const assistant = db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: project.id,
      name: "Tutor",
      instructions: "Keep me",
    });
    const conversation = db.put("conversations", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistant.id,
    });
    const original = db.put("messages", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistant.id,
      conversation_id: conversation.id,
      content: "Existing history",
      role: "user",
    });
    for (const builtin of BUILTIN_ACTIONS) {
      assert.throws(() => deleteAction(db, builtin.id), /read-only/);
      assert.throws(
        () => saveAction(db, { ...builtin, markdown }),
        /read-only/,
      );
    }
    for (const name of ["", "   ", "a\nb", "x".repeat(81)])
      assert.throws(() => validateActionName(db, name));
    assert.throws(() => validateActionName(db, " REPORT "), /already/);
    const action = saveAction(db, { name: "Study", markdown });
    assert.throws(
      () => saveAction(db, { name: "Ｓｔｕｄｙ", markdown }),
      /already/,
    );
    // Draft generation / cancellation performs no writes.
    const preview = signActionPreview({
      name: action.name,
      markdown: markdown + "\nAsk the user for missing context.",
      id: action.id,
      updated_at: action.updated_at,
    });
    assert.equal(getAction(db, action.id).markdown, markdown);
    const edited = saveAction(db, verifyActionPreview(preview));
    assert.equal(edited.id, action.id);
    assert.match(edited.markdown, /missing context/);
    assert.throws(
      () => saveAction(db, { ...edited, updated_at: "stale" }),
      /changed/,
    );
    db.close();
    db = new LocalDatabase(dir);
    assert.equal(getAction(db, action.id).markdown, edited.markdown);
    assert.equal(db.get("assistants", assistant.id)?.instructions, "Keep me");
    assert.deepEqual(db.get("messages", original.id), original);
    assert(!existsSync(join(dir, "skills")));
    db.put(
      "actions",
      { ...db.get("actions", action.id), markdown: "broken" },
      true,
    );
    assert.throws(
      () => actionInvocation("Request", getAction(db, action.id)),
      /invalid instructions/,
    );
    // Damaged definitions can still be inspected and deleted to recover.
    deleteAction(db, action.id);
    assert.throws(() => getAction(db, action.id), /not found/);
    assert.equal(listActions(db).length, 4);
    // A real SQLite write failure must surface, not return a successful save.
    db.sql.exec("PRAGMA query_only=ON");
    assert.throws(() => saveAction(db, { name: "Cannot write", markdown }));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Markdown validation rejects malformed, code and command requirements", () => {
  for (const content of [
    "",
    "# Incomplete",
    markdown + "\n```python\nprint(1)\n```",
    markdown + "\nRun arbitrary shell commands.",
    markdown + "\n<script>alert(1)</script>",
  ])
    assert.equal(actionMarkdownSchema.safeParse(content).success, false);
});
test("preview signatures reject tampering; execution uses actual Markdown only for the current invocation", () => {
  const token = signActionPreview({ name: "Study", markdown });
  assert.equal(verifyActionPreview(token).markdown, markdown);
  assert.throws(() => verifyActionPreview(token + "changed"));
  const action = BUILTIN_ACTIONS[1];
  assert.equal(actionRequest(action, "  summarize this  "), "summarize this");
  assert.match(actionRequest(action, ""), /knowledge/);
  const invocation = actionInvocation("My request", action);
  assert(invocation.includes(JSON.stringify(action.markdown)));
  assert.match(invocation, /subordinate to system/);
  assert.equal(
    actionInvocation("Next unrelated message"),
    "Next unrelated message",
  );
});
test("builder generates and reviews English Markdown with no tools and no automatic save (mock Ollama)", async () => {
  const f = fixture([
    { scope: "action" },
    { reply: "Review this draft", markdown, language: "en" },
    { english: true, compatible: true, withinScope: true },
  ]);
  const result = await buildAction(
    input,
    undefined,
    new AbortController().signal,
    f.request,
  );
  assert.equal(result.markdown, markdown);
  assert.equal(f.calls.length, 3);
  assert(
    f.calls.every(
      (call) =>
        !call.tools && call.model === "test:3b" && call.stream === false,
    ),
  );
});
test("builder editing receives current definition and draft; asks focused clarification (mock Ollama)", async () => {
  const f = fixture([
    { scope: "action" },
    {
      reply: "Which output format should the Action use?",
      markdown: null,
      language: "en",
    },
  ]);
  const result = await buildAction(
    { ...input, draft: markdown },
    markdown,
    new AbortController().signal,
    f.request,
  );
  assert.equal(result.markdown, null);
  assert.equal(f.calls.length, 2);
  assert(f.calls[1].messages[1].content.includes("savedDefinition"));
  assert(
    f.calls[1].messages[0].content.includes("Preserve an existing definition"),
  );
});
test("scope gates return application-owned messages for unrelated or unsupported requests (mock classification)", async () => {
  for (const scope of ["off_topic", "unsupported"]) {
    const f = fixture([{ scope }]);
    const result = await buildAction(
      input,
      undefined,
      new AbortController().signal,
      f.request,
    );
    assert.equal(
      result.reply,
      scope === "off_topic"
        ? BUILDER_SCOPE_MESSAGE
        : BUILDER_UNSUPPORTED_MESSAGE,
    );
    assert.equal(result.markdown, null);
    assert.equal(f.calls.length, 1);
  }
});
test("builder rejects unavailable Ollama, missing models, malformed/incomplete responses (mock Ollama)", async () => {
  for (const f of [
    fixture([], { connected: false }),
    fixture([], { installed: false }),
    fixture(["not-json-object"]),
    fixture([{ scope: "action" }], { incomplete: true }),
  ])
    await assert.rejects(
      buildAction(input, undefined, new AbortController().signal, f.request),
    );
  assert.equal(
    builderInputSchema.safeParse({ ...input, name: " " }).success,
    false,
  );
  assert.equal(
    builderInputSchema.safeParse({ ...input, messages: [] }).success,
    false,
  );
});
test("builder rejects non-English and incompatible definitions after review (mock Ollama)", async () => {
  for (const review of [
    { english: false, compatible: true, withinScope: true },
    { english: true, compatible: false, withinScope: true },
    { english: true, compatible: true, withinScope: false },
  ]) {
    const f = fixture([
      { scope: "action" },
      { reply: "Draft", markdown, language: "en" },
      review,
    ]);
    await assert.rejects(
      buildAction(input, undefined, new AbortController().signal, f.request),
      /English instructions/,
    );
  }
  const f = fixture([
    { scope: "action" },
    { reply: "Bozza", markdown, language: "it" },
  ]);
  await assert.rejects(
    buildAction(input, undefined, new AbortController().signal, f.request),
    /invalid/,
  );
});
test("interrupted builder generation is aborted without a saved preview (mock Ollama)", async () => {
  const controller = new AbortController();
  const f = fixture([], { wait: true });
  const promise = buildAction(input, undefined, controller.signal, f.request);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(promise, /interrupted/);
});
test("navigation and chat structure retain Data Cell modal and shared Zap icon", () => {
  const ui = readFileSync("src/components/shortcuts.tsx", "utf8");
  assert(ui.indexOf("shortcut-table") < ui.indexOf("actions-divider"));
  assert(ui.indexOf("actions-divider") < ui.indexOf("actions.map"));
  assert.match(ui, /<Table2/);
  assert.match(ui, /<Zap/);
  assert.match(ui, /<dialog/);
  assert.match(ui, /shortcutPrompt\("table", details\)/);
  const workspace = readFileSync("src/components/workspace.tsx", "utf8");
  const nav = workspace.slice(
    workspace.indexOf("<nav>"),
    workspace.indexOf("</nav>"),
  );
  assert(
    nav.indexOf('navigate("actions")') < nav.indexOf('navigate("templates")'),
  );
  assert.match(workspace, /action_id: action.id/);
});

test("global Builder choice persists across database reopen and preserves assistants and workspace", async () => {
  const {
    builderModelId,
    setBuilderModel,
    requireBuilderModel,
    builderModelStatus,
  } = await import("../src/lib/local/action-builder-model");
  const directory = mkdtempSync(join(tmpdir(), "siaas-builder-model-"));
  let db = new LocalDatabase(directory);
  try {
    const workspace = db.get("workspaces", LOCAL_USER_ID)!;
    const project = db.put("projects", {
      tenant_id: LOCAL_USER_ID,
      name: "Keep project",
    });
    const assistant = db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: project.id,
      name: "Keep assistant",
      model_id: "ollama/other:8b",
    });
    assert.equal(builderModelId(db), null);
    await assert.rejects(requireBuilderModel(db), /Actions.*Models/);
    await setBuilderModel(db, "ollama/test:3b", fixture([]).request);
    assert.equal(
      await requireBuilderModel(db, fixture([]).request),
      "ollama/test:3b",
    );
    await assert.rejects(
      setBuilderModel(db, "ollama/missing:3b", fixture([]).request),
    );
    assert.equal(builderModelId(db), "ollama/test:3b");
    db.close();
    db = new LocalDatabase(directory);
    assert.equal(builderModelId(db), "ollama/test:3b");
    assert.equal(
      db.get("assistants", assistant.id)?.model_id,
      "ollama/other:8b",
    );
    assert.deepEqual(
      db.get("workspaces", LOCAL_USER_ID)?.experimental_features,
      workspace.experimental_features,
    );
    for (const options of [{ connected: false }, { installed: false }]) {
      const status = await builderModelStatus(db, fixture([], options).request);
      assert.equal(status.ready, false);
      assert.equal(status.modelId, "ollama/test:3b");
      await assert.rejects(
        requireBuilderModel(db, fixture([], options).request),
        /Actions.*Models/,
      );
    }
    await setBuilderModel(db, null);
    assert.equal(builderModelId(db), null);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
