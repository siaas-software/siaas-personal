import { MAX_DOCUMENT_CHARS } from "./catalog";
export function chunkText(input: string, size = 1800, overlap = 250): string[] {
  if (size < 100 || overlap < 0 || overlap >= size)
    throw new Error("Invalid chunk settings");
  const text = input
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text)
    throw new Error(
      "Il documento non contiene testo leggibile. Per le scansioni è necessario eseguire prima un OCR.",
    );
  if (text.length > MAX_DOCUMENT_CHARS)
    throw new Error(
      "Il documento supera 150.000 caratteri. Suddividilo in file più piccoli.",
    );
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + size / 2) end = boundary;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}
