// Exercise the real desktop API and temporary SQLite stores; Ollama is simulated.
// Each suite cleans up its own isolated data and browser.
await import("./guest-ui.mjs");
await import("./project-flows.mjs");
await import("./workbench-ui.mjs");
