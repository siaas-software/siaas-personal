import "server-only";
import { extractRawText } from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { MAX_FILE_BYTES } from "./catalog";
export async function extractDocument(data: Blob, kind: string) {
  if (data.size > MAX_FILE_BYTES) throw new Error("Il file supera 10 MB.");
  const buffer = Buffer.from(await data.arrayBuffer());
  if (kind === "pdf") {
    if (!buffer.subarray(0, 8).toString().includes("%PDF-"))
      throw new Error("Il file non è un PDF valido.");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    try {
      if (pdf.numPages > 300)
        throw new Error(
          "Il PDF supera 300 pagine. Suddividilo in file più piccoli.",
        );
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
  if (kind === "docx") {
    if (buffer.subarray(0, 2).toString() !== "PK")
      throw new Error("Il file non è un DOCX valido.");
    // Mammoth reads archive text only; no HTML is rendered or external files resolved.
    const result = await extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString("utf8");
}
