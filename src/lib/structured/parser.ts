import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { AnalysisError, LIMITS, type Sheet } from "./types";
let active = 0;
export async function parseStructured(
  bytes: Uint8Array,
  kind: string,
): Promise<Sheet[]> {
  if (!bytes.length || bytes.length > LIMITS.bytes)
    throw new AnalysisError("File must contain data and be at most 10 MB.");
  if (active >= 2)
    throw new AnalysisError("Two imports are already running. Retry shortly.");
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(
        join(process.cwd(), "scripts", "structured-parser.cjs"),
        {
          workerData: { bytes, kind },
          resourceLimits: {
            maxOldGenerationSizeMb: 192,
            maxYoungGenerationSizeMb: 32,
          },
          execArgv: [],
        },
      );
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new AnalysisError(
            "Import timed out after 20 seconds. Split the workbook.",
          ),
        );
      }, 20000);
      const finish = () => {
        clearTimeout(timer);
        void worker.terminate();
      };
      worker.once("message", (message) => {
        finish();
        message.error
          ? reject(new AnalysisError(message.error))
          : resolve(message.sheets);
      });
      worker.once("error", () => {
        finish();
        reject(
          new AnalysisError("Parser failed or exceeded its memory limit."),
        );
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code)
          reject(new AnalysisError("Parser stopped before completing."));
      });
    });
  } finally {
    active--;
  }
}
