import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const wasmPath = new URL(
  './target/wasm32-unknown-unknown/release/atlas_ezpz_wasm.wasm',
  import.meta.url,
);
const bytes = fs.readFileSync(wasmPath);
const gzipBytes = gzipSync(bytes, { level: 9 }).length;
const brotliBytes = brotliCompressSync(bytes).length;
const { instance } = await WebAssembly.instantiate(bytes, {});

const validate = instance.exports.atlas_validate;
const benchmark = instance.exports.atlas_benchmark;
if (typeof validate !== 'function' || typeof benchmark !== 'function') {
  throw new Error(
    `Missing raw wasm exports; found: ${Object.keys(instance.exports).join(', ')}`,
  );
}

const validationFailures = validate();
if (validationFailures !== 0) {
  throw new Error(`WASM canonical trajectory validation failures: ${validationFailures}`);
}

// Warm V8/WASM and Rust allocation paths before measuring.
benchmark(2_000);

const samples = 50_000;
const started = performance.now();
const checksum = benchmark(samples);
const elapsedMs = performance.now() - started;
if (!Number.isFinite(checksum)) {
  throw new Error('WASM benchmark returned a non-finite checksum');
}

console.log(
  JSON.stringify(
    {
      runtime: `Node ${process.version} / V8 ${process.versions.v8}`,
      wasmBytes: bytes.length,
      gzipBytes,
      brotliBytes,
      validationFailures,
      samples,
      elapsedMs,
      solvesPerSecond: samples / (elapsedMs / 1000),
      checksum,
    },
    null,
    2,
  ),
);
