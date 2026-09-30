// Writes the checked tree as a WebAssembly binary module (no external tools).
// Types: int -> i64, float -> f64, bool -> i32, str -> i64 packing (address << 32 | length).
// Text lives in the module's memory: literals in a data segment, new text on a heap the host
// fills (from the exported `heap_base`). Showing values and building text are imported from the host.

const VALTYPE = { int: 0x7e, float: 0x7c, bool: 0x7f, str: 0x7e };
const IMPORTS = [
  ['say_int', ['int'], 'void'], ['say_float', ['float'], 'void'], ['say_bool', ['bool'], 'void'], ['say_str', ['str'], 'void'],
  ['concat', ['str', 'str'], 'str'], ['str_eq', ['str', 'str'], 'bool'],
  ['int_to_str', ['int'], 'str'], ['float_to_str', ['float'], 'str'], ['bool_to_str', ['bool'], 'str']
];
const call = (name) => [0x10, ...u32(IMPORTS.findIndex(([n]) => n === name))];
const OPS = {
  int: { '+': 0x7c, '-': 0x7d, '*': 0x7e, '/': 0x7f, '%': 0x81, '==': 0x51, '!=': 0x52, '<': 0x53, '>': 0x55, '<=': 0x57, '>=': 0x59 },
  float: { '+': 0xa0, '-': 0xa1, '*': 0xa2, '/': 0xa3, '==': 0x61, '!=': 0x62, '<': 0x63, '>': 0x64, '<=': 0x65, '>=': 0x66 },
  bool: { '==': 0x46, '!=': 0x47 }
};
const CONVERSIONS = { int_to_int: [], float_to_float: [], int_to_float: [0xb9], float_to_int: [0xfc, 0x06] }; // i64.trunc_sat_f64_s: never traps
const EMPTY = 0x40;

// ---- binary encoding helpers ----
function u32(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
}
function s64(value) {
  const out = [];
  for (;;) {
    const byte = Number(value & 0x7fn);
    value >>= 7n;
    const done = (value === 0n && !(byte & 0x40)) || (value === -1n && byte & 0x40);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}
function f64(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return [...new Uint8Array(view.buffer)];
}
const utf8 = (text) => [...new TextEncoder().encode(text)];
const name = (text) => { const bytes = utf8(text); return [...u32(bytes.length), ...bytes]; };
const vector = (items) => [...u32(items.length), ...items.flat()];
const section = (id, bytes) => [id, ...u32(bytes.length), ...bytes];

export function generate(program) {
  const signatures = [];
  const signature = (params, result) => {
    const bytes = [0x60, ...vector(params.map(type => [VALTYPE[type]])), ...vector(result === 'void' ? [] : [[VALTYPE[result]]])];
    const key = bytes.join(',');
    let index = signatures.findIndex(existing => existing.join(',') === key);
    if (index < 0) index = signatures.push(bytes) - 1;
    return index;
  };
  const importTypes = IMPORTS.map(([, params, result]) => signature(params, result));
  const functionIndex = new Map(program.functions.map((fn, i) => [fn.name, IMPORTS.length + i]));
  const functionTypes = program.functions.map(fn => signature(fn.params.map(p => p.type), fn.returns));

  // Text literals go into a data segment; identical texts share one copy.
  const data = [];
  const strings = new Map();
  const DATA_START = 8;
  const addString = (text) => {
    if (!strings.has(text)) { strings.set(text, DATA_START + data.length); data.push(...utf8(text)); }
    return { address: strings.get(text), length: utf8(text).length };
  };

  function expr(node, code) {
    switch (node.kind) {
      case 'int': code.push(0x42, ...s64(BigInt(node.value))); return;
      case 'float': code.push(0x44, ...f64(Number(node.value))); return;
      case 'bool': code.push(0x41, node.value ? 1 : 0); return;
      case 'string': {
        const { address, length } = addString(node.value);
        code.push(0x42, ...s64((BigInt(address) << 32n) | BigInt(length)));
        return;
      }
      case 'template': // "a{b}c" -> concat(concat("a", text(b)), "c")
        node.parts.forEach((part, i) => {
          expr(part, code);
          if (part.type !== 'str') code.push(...call(`${part.type}_to_str`));
          if (i > 0) code.push(...call('concat'));
        });
        return;
      case 'name': code.push(0x20, ...u32(node.local)); return;
      case 'unary':
        if (node.op === '!') { expr(node.value, code); code.push(0x45); return; } // i32.eqz
        if (node.type === 'float') { expr(node.value, code); code.push(0x9a); return; } // f64.neg
        code.push(0x42, 0); expr(node.value, code); code.push(0x7d); return; // 0 - x
      case 'binary':
        if (node.op === '&&' || node.op === '||') { // short-circuit: the right side runs only when needed
          expr(node.left, code);
          code.push(0x04, VALTYPE.bool);
          if (node.op === '&&') { expr(node.right, code); code.push(0x05, 0x41, 0); }
          else { code.push(0x41, 1, 0x05); expr(node.right, code); }
          code.push(0x0b);
          return;
        }
        expr(node.left, code);
        expr(node.right, code);
        if (node.left.type === 'str') code.push(...call(node.op === '+' ? 'concat' : 'str_eq'), ...(node.op === '!=' ? [0x45] : []));
        else code.push(OPS[node.left.type][node.op]);
        return;
      case 'call':
        for (const arg of node.args) expr(arg, code);
        if (node.builtin in CONVERSIONS) { code.push(...CONVERSIONS[node.builtin]); return; }
        if (node.builtin === 'len') { code.push(0x42, ...s64(0xffffffffn), 0x83); return; } // length = low 32 bits
        code.push(0x10, ...u32(functionIndex.get(node.name)));
        return;
    }
  }

  function statement(node, code) {
    switch (node.kind) {
      case 'let':
      case 'assign': expr(node.value, code); code.push(0x21, ...u32(node.local)); return;
      case 'expr': expr(node.value, code); if (node.value.type !== 'void') code.push(0x1a); return; // drop unused values
      case 'say': expr(node.value, code); code.push(...call(`say_${node.value.type}`)); return;
      case 'return': if (node.value) expr(node.value, code); code.push(0x0f); return;
      case 'if':
        expr(node.condition, code);
        code.push(0x04, EMPTY);
        for (const inner of node.then) statement(inner, code);
        if (node.otherwise.length) { code.push(0x05); for (const inner of node.otherwise) statement(inner, code); }
        code.push(0x0b);
        return;
      case 'while': // block { loop { if !cond break; body; continue } }
        code.push(0x02, EMPTY, 0x03, EMPTY);
        expr(node.condition, code);
        code.push(0x45, 0x0d, 1);
        for (const inner of node.body) statement(inner, code);
        code.push(0x0c, 0, 0x0b, 0x0b);
        return;
      case 'repeat': // counter = 0; limit = count; while counter < limit { body; counter += 1 }
        expr(node.count, code);
        code.push(0x21, ...u32(node.limit), 0x42, 0, 0x21, ...u32(node.counter));
        loop(code, [0x20, ...u32(node.counter), 0x20, ...u32(node.limit), 0x59], node.body, node.counter); // i64.ge_s
        return;
      case 'for': // i = from; limit = to; while i <= limit { body; i += 1 }
        expr(node.from, code);
        code.push(0x21, ...u32(node.local));
        expr(node.to, code);
        code.push(0x21, ...u32(node.limit));
        loop(code, [0x20, ...u32(node.local), 0x20, ...u32(node.limit), 0x55], node.body, node.local); // i64.gt_s
        return;
    }
  }
  /** block { loop { if done break; body; step += 1; continue } } */
  function loop(code, done, body, step) {
    code.push(0x02, EMPTY, 0x03, EMPTY, ...done, 0x0d, 1);
    for (const inner of body) statement(inner, code);
    code.push(0x20, ...u32(step), 0x42, 1, 0x7c, 0x21, ...u32(step), 0x0c, 0, 0x0b, 0x0b);
  }

  const bodies = program.functions.map(fn => {
    const code = [];
    for (const node of fn.body) statement(node, code);
    if (fn.returns !== 'void') code.push(0x00); // the checker guarantees a return before this point
    code.push(0x0b);
    const locals = fn.locals.slice(fn.params.length).map(type => [1, VALTYPE[type]]);
    const body = [...vector(locals), ...code];
    return [...u32(body.length), ...body];
  });

  const heapBase = Math.ceil((DATA_START + data.length) / 8) * 8;
  const pages = Math.max(1, Math.ceil(heapBase / 65536));
  const module = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vector(signatures)),
    ...section(2, vector(IMPORTS.map(([field], i) => [...name('env'), ...name(field), 0x00, ...u32(importTypes[i])]))),
    ...section(3, vector(functionTypes.map(index => u32(index)))),
    ...section(5, vector([[0x00, ...u32(pages)]])),
    ...section(6, vector([[VALTYPE.bool, 0x00, 0x41, ...s64(BigInt(heapBase)), 0x0b]])), // const i32 heap_base
    ...section(7, vector([[...name('main'), 0x00, ...u32(functionIndex.get('main'))], [...name('memory'), 0x02, 0], [...name('heap_base'), 0x03, 0]])),
    ...section(10, vector(bodies)),
    ...(data.length ? section(11, vector([[0x00, 0x41, ...s64(BigInt(DATA_START)), 0x0b, ...vector(data.map(byte => [byte]))]])) : [])
  ];
  return new Uint8Array(module);
}
