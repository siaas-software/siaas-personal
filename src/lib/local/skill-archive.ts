import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { posix } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";

// yauzl is already pinned by the desktop archive readers.
import { fromBufferPromise } from "yauzl";
export const maxSkillArchive = 256 * 1024;

export async function inspectSkillArchive(bytes: Buffer) {
  if (!bytes.length || bytes.length > maxSkillArchive)
    throw new Error("Invalid Skill archive size.");
  const zip = await fromBufferPromise(bytes, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const files: Record<string, string> = {};
  const names = new Set<string>();
  let slug = "",
    total = 0;
  try {
    if (zip.entryCount > 32) throw new Error("Too many entries.");
    for await (const entry of zip.eachEntry()) {
      const path: string = entry.fileName;
      const match =
        /^([a-z0-9]+(?:-[a-z0-9]+)*)\/(SKILL\.md|references\/[A-Za-z0-9_-]+\.md|references\/|)$/.exec(
          path,
        );
      if (
        !match ||
        match[1].length > 64 ||
        (slug && slug !== match[1]) ||
        names.has(path.toLowerCase())
      )
        throw new Error("Unsupported or duplicate Skill path.");
      names.add(path.toLowerCase());
      slug = match[1];
      const directory = path.endsWith("/");
      const mode = entry.externalFileAttributes >>> 16;
      const type = mode & 0o170000;
      if (
        (type && type !== (directory ? 0o040000 : 0o100000)) ||
        (!directory && mode & 0o111) ||
        entry.generalPurposeBitFlag & 1 ||
        ![0, 8].includes(entry.compressionMethod) ||
        (directory && entry.uncompressedSize !== 0) ||
        entry.uncompressedSize > 30000
      )
        throw new Error("Unsupported Skill entry.");
      if (directory) continue;
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = await zip.openReadStreamPromise(entry);
      for await (const chunk of stream) {
        size += chunk.length;
        total += chunk.length;
        if (size > entry.uncompressedSize || total > 160000)
          throw new Error("Expanded Skill exceeds size limit.");
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      if (size !== entry.uncompressedSize || crc32(data) !== entry.crc32)
        throw new Error("Skill checksum mismatch.");
      const body = new TextDecoder("utf-8", { fatal: true }).decode(data);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body))
        throw new Error("Invalid Markdown text.");
      files[match[2]] = body;
    }
  } finally {
    zip.close();
  }
  const document = files["SKILL.md"]?.replace(/\r\n/g, "\n") ?? "";
  const header = /^---\n([\s\S]+?)\n---\n([\s\S]+)$/.exec(document);
  if (!header || !header[2].trim())
    throw new Error("Missing Skill instructions.");
  const metadata = new Map<string, string>();
  for (const line of header[1].split("\n")) {
    const field = /^(name|description|version|author|license): (.+)$/.exec(
      line,
    );
    if (
      !field ||
      metadata.has(field[1]) ||
      /^[!&*|>{}\[\]]/.test(field[2]) ||
      field[2].length > 1024
    )
      throw new Error("Invalid Skill metadata.");
    metadata.set(field[1], field[2].trim());
  }
  if (metadata.get("name") !== slug || !metadata.get("description"))
    throw new Error("Skill identity mismatch.");
  for (const [path, content] of Object.entries(files)) {
    const tree = unified()
      .use(remarkParse)
      .parse(path === "SKILL.md" ? header[2] : content);
    const visit = (node: {
      type: string;
      url?: string;
      children?: typeof tree.children | unknown[];
    }) => {
      if (
        node.type === "html" ||
        node.type === "image" ||
        node.type === "imageReference"
      )
        throw new Error("Unsupported embedded content.");
      if (node.url !== undefined) {
        const [target] = node.url.split("#");
        if (
          target &&
          (!/^(?:references\/)?[A-Za-z0-9_-]+\.md$/.test(target) ||
            !Object.hasOwn(files, posix.join(posix.dirname(path), target)))
        )
          throw new Error("Invalid Markdown reference.");
      }
      for (const child of node.children ?? [])
        visit(child as Parameters<typeof visit>[0]);
    };
    visit(tree);
  }
  return {
    slug,
    description: metadata.get("description")!,
    version: metadata.get("version") ?? null,
    author: metadata.get("author") ?? null,
    license: metadata.get("license") ?? null,
    instructions: header[2],
    files,
    sourceArchiveSha256: createHash("sha256").update(bytes).digest("hex"),
    digest: createHash("sha256")
      .update(
        JSON.stringify(
          Object.keys(files)
            .sort()
            .map((key) => [key, files[key]]),
        ),
      )
      .digest("hex"),
  };
}
