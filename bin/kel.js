#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { compile, run, formatError } from '../src/index.js';

const USAGE = `Kel: easy like Python, fast like WebAssembly.

  kel run   <file.lus>              compile and run
  kel build <file.lus> [-o out.wasm] compile to a .wasm file
  kel check <file.lus>              find mistakes without running`;

const [command, file, ...rest] = process.argv.slice(2);
if (!['run', 'build', 'check'].includes(command) || !file) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}

let source;
try { source = readFileSync(file, 'utf8'); }
catch { console.error(`Can't open ${file}`); process.exit(1); }

try {
  const started = performance.now();
  const bytes = compile(source);
  const compiled = performance.now() - started;
  if (command === 'check') console.log(`No problems found in ${file}`);
  if (command === 'build') {
    const flag = rest.indexOf('-o');
    const out = flag >= 0 && rest[flag + 1] ? rest[flag + 1] : file.replace(/\.lus$/, '') + '.wasm';
    writeFileSync(out, bytes);
    console.log(`Built ${out} (${bytes.length} bytes in ${compiled.toFixed(1)} ms)`);
  }
  if (command === 'run') await run(bytes);
} catch (error) {
  console.error(formatError(error, source, file));
  process.exit(1);
}
