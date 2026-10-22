export type MarkdownBlock =
  { text: string } | { headers: string[]; rows: string[][] };
function cells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}
// Parse pipe tables without interpreting model output as HTML. Fenced code is
// left untouched, including examples containing table-shaped text.
export function markdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split("\n"),
    blocks: MarkdownBlock[] = [];
  let text: string[] = [],
    fence = "";
  const flush = () => {
    if (text.length) blocks.push({ text: text.join("\n") });
    text = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const mark = lines[i].trim().match(/^(`{3,}|~{3,})/);
    if (mark) {
      if (!fence) fence = mark[1];
      else if (mark[1][0] === fence[0] && mark[1].length >= fence.length)
        fence = "";
      text.push(lines[i]);
      continue;
    }
    const separator = i + 1 < lines.length ? cells(lines[i + 1]) : [];
    const headers = cells(lines[i]);
    if (
      !fence &&
      lines[i].includes("|") &&
      headers.length > 1 &&
      headers.length === separator.length &&
      separator.every((c) => /^:?-{3,}:?$/.test(c))
    ) {
      flush();
      const rows: string[][] = [];
      i++;
      while (
        i + 1 < lines.length &&
        lines[i + 1].trim() &&
        lines[i + 1].includes("|")
      ) {
        const row = cells(lines[++i]);
        rows.push(headers.map((_, index) => row[index] ?? ""));
      }
      blocks.push({ headers, rows });
    } else text.push(lines[i]);
  }
  flush();
  return blocks;
}
