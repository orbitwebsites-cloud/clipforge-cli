/**
 * Minimal asar extractor. Electron's asar format:
 *   u32 pickleHeaderSize (always 4)
 *   u32 headerPayloadSize
 *   u32 jsonLength
 *   utf8 json (directory tree)
 *   ...file bytes, offsets relative to the end of the 8+headerPayloadSize block
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [, , archive, outDir = 'unpacked'] = process.argv;
if (!archive) {
  console.error('usage: node tools/unasar.js <app.asar> [outDir]');
  process.exit(1);
}

const buf = readFileSync(archive);
const headerPayloadSize = buf.readUInt32LE(4);
const jsonLen = buf.readUInt32LE(12);
const header = JSON.parse(buf.slice(16, 16 + jsonLen).toString('utf8'));
const base = 8 + headerPayloadSize;

let files = 0;
let bytes = 0;

function walk(node, rel) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const target = path.join(rel, name);
    if (entry.files) {
      walk(entry, target);
    } else if (entry.offset !== undefined) {
      const start = base + Number(entry.offset);
      const dest = path.join(outDir, target);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, buf.slice(start, start + entry.size));
      files++;
      bytes += entry.size;
    }
  }
}

mkdirSync(outDir, { recursive: true });
walk(header, '');
console.log(`extracted ${files} files (${(bytes / 1048576).toFixed(1)} MB) -> ${outDir}`);
