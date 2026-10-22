import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const { ollamaStatus } = await import("../src/lib/ollama");
const { EMBEDDING_MODEL } = await import("../src/lib/catalog");
const runtime = await ollamaStatus();
console.log(runtime.message);
console.log(
  `Embedding ${EMBEDDING_MODEL}: ${runtime.embeddingReady ? "installato" : "assente"}`,
);
for (const model of runtime.models)
  console.log(
    `${model.name}: ${model.available ? "installato" : `assente — ollama pull ${model.id.slice(7)}`}`,
  );
if (
  !runtime.connected ||
  !runtime.embeddingReady ||
  !runtime.models.some((m) => m.available)
)
  process.exitCode = 1;
