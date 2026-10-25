// Extract into a fresh private staging directory; never traverse archive symlinks.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
async function extractZip(archive, destination) {
  const root = await fsp.realpath(destination);
  if ((await fsp.readdir(root)).length) throw new Error('ZIP staging directory must be empty');
  const zip = await new Promise((ok, fail) => yauzl.open(archive,
    { lazyEntries: true, autoClose: false, strictFileNames: true }, (e, z) => e ? fail(e) : ok(z)));
  const links = [], names = new Set();
  let bytes = 0, count = 0;
  const inside = p => p !== root && p.startsWith(root + path.sep);
  const stream = entry => new Promise((ok, fail) => zip.openReadStream(entry, (e, s) => e ? fail(e) : ok(s)));
  try {
    await new Promise((ok, fail) => {
      zip.on('error', fail); zip.on('end', ok);
      zip.on('entry', entry => { (async () => {
        const name = entry.fileName.replace(/\/$/, '');
        const target = path.resolve(root, name);
        if (!name || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name) ||
            name.split('/').includes('..') || !inside(target) || names.has(target))
          throw new Error('Unsafe or duplicate ZIP path');
        names.add(target); bytes += entry.uncompressedSize;
        if (++count > 100000 || bytes > 8 * 1024 ** 3) throw new Error('ZIP resource limit exceeded');
        const mode = entry.externalFileAttributes >>> 16, type = mode & 0o170000;
        if (type === 0o120000) {
          if (entry.uncompressedSize > 4096) throw new Error('ZIP symlink too long');
          const chunks = []; for await (const chunk of await stream(entry)) chunks.push(chunk);
          const link = Buffer.concat(chunks).toString('utf8');
          const resolved = path.resolve(path.dirname(target), link);
          if (!link || link.includes('\0') || link.includes('\\') || path.isAbsolute(link) ||
              /^[A-Za-z]:/.test(link) || !inside(resolved)) throw new Error('Unsafe ZIP symlink');
          links.push({ target, link });
        } else if (entry.fileName.endsWith('/')) {
          await fsp.mkdir(target, { recursive: true });
        } else {
          if (type && type !== 0o100000) throw new Error('Unsupported ZIP entry');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await pipeline(await stream(entry), fs.createWriteStream(target,
            { flags: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 }));
        }
        zip.readEntry();
      })().catch(fail); });
      zip.readEntry();
    });
    // No symlinks exist during file writes. Reject aliases used as parents.
    for (const { target } of links)
      if ([...names].some(n => n.startsWith(target + path.sep))) throw new Error('ZIP symlink used as parent');
    for (const { target, link } of links) {
      await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.symlink(link, target);
    }
  } finally { zip.close(); }
}
module.exports = { extractZip };
