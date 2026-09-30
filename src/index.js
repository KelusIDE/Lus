// Kel: clean { } syntax, typed like Rust, compiles to WebAssembly.
// The compiler has no dependencies, so the same code runs in Node and in the browser.
import { lex, KelError } from './lexer.js';
import { parse } from './parser.js';
import { check } from './checker.js';
import { generate } from './codegen.js';

export { KelError };

/** Kel source text -> WebAssembly bytes. Throws KelError (with line and col) for mistakes. */
export function compile(source) {
  return generate(check(parse(lex(source))));
}

/** Runs compiled bytes; `write` receives each line the program says. */
export async function run(bytes, write = console.log) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let memory;
  let heap;
  const view = (packed) => new Uint8Array(memory.buffer, Number(packed >> 32n), Number(packed & 0xffffffffn));
  // New text goes on a simple heap after the program's own text; memory grows when it runs out.
  const store = (data) => {
    const end = heap + data.length;
    if (end > memory.buffer.byteLength) memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
    new Uint8Array(memory.buffer).set(data, heap);
    const packed = (BigInt(heap) << 32n) | BigInt(data.length);
    heap = Math.ceil(end / 8) * 8;
    return packed;
  };
  const formatFloat = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
  const env = {
    say_int: (value) => write(String(value)),
    say_float: (value) => write(formatFloat(value)),
    say_bool: (value) => write(value ? 'true' : 'false'),
    say_str: (value) => write(decoder.decode(view(value))),
    concat: (a, b) => {
      const left = view(a), right = view(b);
      const joined = new Uint8Array(left.length + right.length);
      joined.set(left);
      joined.set(right, left.length);
      return store(joined);
    },
    str_eq: (a, b) => {
      const left = view(a), right = view(b);
      return left.length === right.length && left.every((byte, i) => byte === right[i]) ? 1 : 0;
    },
    int_to_str: (value) => store(encoder.encode(String(value))),
    float_to_str: (value) => store(encoder.encode(formatFloat(value))),
    bool_to_str: (value) => store(encoder.encode(value ? 'true' : 'false'))
  };
  const { instance } = await WebAssembly.instantiate(bytes, { env });
  memory = instance.exports.memory;
  heap = instance.exports.heap_base.value;
  try {
    instance.exports.main();
  } catch (error) {
    throw new Error(runtimeMessage(error));
  }
}

function runtimeMessage(error) {
  const message = String(error?.message ?? error);
  if (/divide by zero/i.test(message)) return 'Your program divided an int by zero';
  if (/remainder by zero/i.test(message)) return "Your program used '%' with zero";
  if (/overflow/i.test(message)) return 'A number got too big for an int';
  if (/call stack|recursion/i.test(message)) return 'A function called itself too many times (infinite recursion?)';
  return message;
}

/** A mistake as `file:line:col: message`, with the line and a ^ under the spot. */
export function formatError(error, source, file = 'main.lus') {
  if (!(error instanceof KelError)) return String(error?.message ?? error);
  const line = source.replace(/\r\n?/g, '\n').split('\n')[error.line - 1] ?? '';
  return `${file}:${error.line}:${error.col}: ${error.message}\n    ${line}\n    ${' '.repeat(Math.max(0, error.col - 1))}^`;
}
