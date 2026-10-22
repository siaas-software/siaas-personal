import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const { requireOllama, embedLocal, streamLocal } =
  await import("../src/lib/ollama");
try {
  const runtime = await requireOllama();
  const model = runtime.models.find((m) => m.available);
  if (!model)
    throw new Error("Scarica un modello chat: ollama pull qwen2.5:1.5b");
  const [vector] = await embedLocal(
    ["Il servizio di assistenza risponde entro due giorni lavorativi."],
    "document",
    runtime.embeddingProfile,
  );
  console.log(
    `Embedding reale: ${vector.length} dimensioni. Modello chat: ${model.id}`,
  );
  let output = "";
  let finished = false;
  for await (const event of streamLocal(model.id, [
    {
      role: "system",
      content:
        "Rispondi brevemente in italiano basandoti su questa fonte: il servizio di assistenza risponde entro due giorni lavorativi.",
    },
    { role: "user", content: "Quando risponde il servizio di assistenza?" },
  ])) {
    if (event.type === "delta") {
      output += event.text;
      process.stdout.write(event.text);
    } else {
      finished = true;
      console.log(
        `\nToken input: ${event.inputTokens}; output: ${event.outputTokens}.`,
      );
    }
  }
  if (!finished || !output.trim())
    throw new Error("Generazione incompleta o vuota.");
  console.log(
    "PASS: embedding e generazione locali completati. Valuta la risposta prima di usare i tuoi documenti.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Test locale non riuscito.",
  );
  process.exitCode = 1;
}
