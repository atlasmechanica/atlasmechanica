import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const root = new URL('../dist/assets/', import.meta.url);
const directory = root.pathname;
const files = fs.readdirSync(directory).filter((name) => /\.(js|css)$/.test(name)).sort();
const report = files.map((name) => {
  const bytes = fs.readFileSync(path.join(directory, name));
  return { name, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length, brotliBytes: brotliCompressSync(bytes).length };
});
console.log(JSON.stringify({ files: report, total: report.reduce((total,file)=>({rawBytes:total.rawBytes+file.rawBytes,gzipBytes:total.gzipBytes+file.gzipBytes,brotliBytes:total.brotliBytes+file.brotliBytes}),{rawBytes:0,gzipBytes:0,brotliBytes:0}) }, null, 2));
