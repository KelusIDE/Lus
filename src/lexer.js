
export class KelError extends Error {
  constructor(message, line, col) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

const KEYWORDS = new Set(['fn', 'let', 'var', 'if', 'else', 'while', 'repeat', 'for', 'in', 'return', 'say', 'true', 'false']);
const SYMBOLS = ['->', '..', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '(', ')', '{', '}', ',', ':', ';'];
const WORD_HINTS = {
  and: "Kel writes 'and' as &&", or: "Kel writes 'or' as ||", not: "Kel writes 'not' as !",
  def: 'Kel makes functions with fn', function: 'Kel makes functions with fn', func: 'Kel makes functions with fn',
  elif: 'Kel writes this as: else if', const: 'Kel uses let for values that never change', None: 'Kel has no None/null'
};
const SYMBOL_HINTS = {
  '#': 'Comments in Kel start with //',
  "'": 'Text goes in double quotes, like "hello"',
  '&': 'Use && for "and"',
  '|': 'Use || for "or"',
  '[': 'Lists are not in Kel yet (they are on the roadmap)'
};

export function lex(source, line = 1, col = 1) {
  const tokens = [];
  const text = source.replace(/\r\n?/g, '\n');
  let depth = 0;
  let i = 0;
  const fail = (message) => { throw new KelError(message, line, col); };
  const advance = (count) => { for (let n = 0; n < count; n++) { if (text[i] === '\n') { line++; col = 1; } else col++; i++; } };

  while (i < text.length) {
    const ch = text[i];
    const start = { line, col };
    if (ch === '\n') {
      if (depth === 0 && tokens.length && tokens.at(-1).type !== 'newline') tokens.push({ type: 'newline', ...start });
      advance(1);
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(1); continue; }
    if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') advance(1); continue; }

    if (/[0-9]/.test(ch)) {
      const match = /^[0-9][0-9_]*(\.[0-9][0-9_]*)?/.exec(text.slice(i));
      tokens.push({ type: match[1] ? 'float' : 'int', value: match[0].replaceAll('_', ''), ...start });
      advance(match[0].length);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))[0];
      if (WORD_HINTS[word]) fail(WORD_HINTS[word]);
      tokens.push({ type: KEYWORDS.has(word) ? word : 'name', value: word, ...start });
      advance(word.length);
      continue;
    }
    if (ch === '"') {
      tokens.push({ type: 'string', parts: stringParts(), ...start });
      continue;
    }
    const symbol = SYMBOLS.find(s => text.startsWith(s, i));
    if (!symbol) fail(SYMBOL_HINTS[ch] ?? `Kel doesn't know the symbol '${ch}'`);
    if (symbol === '(') depth++;
    if (symbol === ')') depth = Math.max(0, depth - 1);
    tokens.push({ type: symbol, ...start });
    advance(symbol.length);
  }
  tokens.push({ type: 'eof', line, col });
  return tokens;

  function stringParts() {
    const open = { line, col };
    const parts = [];
    let chunk = '';
    advance(1);
    for (;;) {
      if (i >= text.length || text[i] === '\n') throw new KelError('This text is missing its closing "', open.line, open.col);
      const c = text[i];
      if (c === '"') { advance(1); break; }
      if (c === '\\') {
        const escaped = text[i + 1];
        chunk += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped ?? '';
        advance(2);
        continue;
      }
      if (c === '{') {
        let end = i + 1;
        let nesting = 0;
        while (end < text.length && !(text[end] === '}' && nesting === 0)) {
          if (text[end] === '"' || text[end] === '\n') throw new KelError("This {...} in the text is missing its closing '}'", line, col);
          if (text[end] === '(') nesting++;
          if (text[end] === ')') nesting--;
          end++;
        }
        const code = text.slice(i + 1, end);
        if (!code.trim()) throw new KelError('Put a value inside { }, like "{name}". Write \\{ for a plain {', line, col);
        if (chunk) parts.push(chunk);
        chunk = '';
        parts.push({ tokens: lex(code, line, col + 1) });
        advance(end - i + 1);
        continue;
      }
      chunk += c;
      advance(1);
    }
    if (chunk || !parts.length) parts.push(chunk);
    return parts;
  }
}
