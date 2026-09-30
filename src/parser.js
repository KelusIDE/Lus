// Builds the syntax tree from tokens (recursive descent).
//
//   program   := fn*
//   fn        := 'fn' name ('(' params ')')? ('->' type)? block
//   block     := '{' statement* '}'            statements end at a line break, ';' or '}'
//   statement := ('let' | 'var') name (':' type)? '=' expr
//              | name ('=' | '+=' | '-=' | '*=' | '/=' | '%=') expr
//              | 'if' expr block ('else' (if | block))?
//              | 'while' expr block | 'repeat' expr block | 'for' name 'in' expr '..' expr block
//              | 'return' expr? | 'say' expr | expr
import { KelError } from './lexer.js';

export const TYPES = new Set(['int', 'float', 'bool', 'str']);
const LEVELS = [['||'], ['&&'], ['==', '!=', '<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
const COMPARISON = 2;
const COMPOUND = { '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%' };
const BLOCK_HINT = "Kel uses { } for blocks, like: if x > 3 { ... }";

export function parse(tokens) {
  return parser(tokens).program();
}

function parser(tokens) {
  let pos = 0;
  const peek = (offset = 0) => tokens[Math.min(pos + offset, tokens.length - 1)];
  const at = (type) => peek().type === type;
  const next = () => tokens[pos++];
  const fail = (message, token = peek()) => { throw new KelError(message, token.line, token.col); };
  const expect = (type, message) => (at(type) ? next() : fail(message));
  const skipBreaks = () => { while (at('newline') || at(';')) next(); };

  function type() {
    const token = expect('name', 'Expected a type: int, float, bool or str');
    if (!TYPES.has(token.value)) fail(`Unknown type '${token.value}'. Kel has int, float, bool and str`, token);
    return token.value;
  }

  function fn() {
    const start = next();
    const name = expect('name', 'Give the function a name, like: fn main { }');
    const params = [];
    if (at('(')) {
      next();
      while (!at(')')) {
        if (params.length) expect(',', "Separate parameters with ','");
        const param = expect('name', 'Expected a parameter name');
        expect(':', `Give '${param.value}' a type, like: ${param.value}: int`);
        params.push({ name: param.value, type: type(), line: param.line, col: param.col });
      }
      next();
    }
    let returns = 'void';
    if (at('->')) { next(); returns = type(); }
    return { name: name.value, params, returns, body: block('function'), line: start.line, col: start.col };
  }

  function block(what) {
    while (at('newline')) next();
    if (at(':')) fail(BLOCK_HINT);
    const open = expect('{', `Expected '{' to start the ${what}`);
    const body = [];
    skipBreaks();
    while (!at('}')) {
      if (at('eof')) fail("This block is missing its closing '}'", open);
      body.push(statement());
      if (!at('}')) {
        if (at(':')) fail(BLOCK_HINT);
        if (!at('newline') && !at(';')) fail('Expected the end of the line here');
      }
      skipBreaks();
    }
    next();
    return body;
  }

  function statement() {
    const token = peek();
    const place = { line: token.line, col: token.col };
    if (at('let') || at('var')) {
      next();
      const name = expect('name', `Expected a name after '${token.type}'`);
      let declared = null;
      if (at(':')) { next(); declared = type(); }
      expect('=', `Give '${name.value}' a starting value, like: ${token.type} ${name.value} = 0`);
      return { kind: 'let', mutable: token.type === 'var', name: name.value, declared, value: expression(), ...place };
    }
    if (at('if')) return ifStatement();
    if (at('while')) { next(); return { kind: 'while', condition: expression(), body: block('while loop'), ...place }; }
    if (at('repeat')) { next(); return { kind: 'repeat', count: expression(), body: block('repeat loop'), ...place }; }
    if (at('for')) {
      next();
      const name = expect('name', 'Name the counter, like: for i in 1..10 { }');
      expect('in', "Expected 'in', like: for i in 1..10 { }");
      const from = expression();
      expect('..', "Expected '..' between the first and last number, like: 1..10");
      return { kind: 'for', name: name.value, from, to: expression(), body: block('for loop'), ...place };
    }
    if (at('return')) {
      next();
      const value = at('newline') || at(';') || at('}') ? null : expression();
      return { kind: 'return', value, ...place };
    }
    if (at('say')) { next(); return { kind: 'say', value: expression(), ...place }; }
    if (at('name') && (peek(1).type === '=' || peek(1).type in COMPOUND)) {
      const name = next();
      const op = next().type;
      const value = expression();
      const target = { kind: 'name', name: name.value, line: name.line, col: name.col };
      return { kind: 'assign', name: name.value, value: op === '=' ? value : { kind: 'binary', op: COMPOUND[op], left: target, right: value, ...place }, ...place };
    }
    return { kind: 'expr', value: expression(), ...place };
  }

  function ifStatement() {
    const token = next();
    const condition = expression();
    const then = block('if block');
    let otherwise = [];
    let ahead = 0;
    while (peek(ahead).type === 'newline') ahead++; // allow `}` and `else` on separate lines
    if (peek(ahead).type === 'else') {
      pos += ahead + 1;
      otherwise = at('if') ? [ifStatement()] : block('else block');
    }
    return { kind: 'if', condition, then, otherwise, line: token.line, col: token.col };
  }

  function expression(level = 0) {
    if (level === LEVELS.length) return unary();
    let left = expression(level + 1);
    while (LEVELS[level].includes(peek().type)) {
      const op = next();
      const right = expression(level + 1);
      left = { kind: 'binary', op: op.type, left, right, line: op.line, col: op.col };
      if (level === COMPARISON && LEVELS[level].includes(peek().type)) fail('Compare two values at a time, like: a < b && b < c');
    }
    return left;
  }

  function unary() {
    if (at('-') || at('!')) {
      const op = next();
      return { kind: 'unary', op: op.type, value: unary(), line: op.line, col: op.col };
    }
    return primary();
  }

  function primary() {
    const token = peek();
    const place = { line: token.line, col: token.col };
    if (at('int') || at('float')) { next(); return { kind: token.type, value: token.value, ...place }; }
    if (at('string')) {
      next();
      if (token.parts.length === 1 && typeof token.parts[0] === 'string') return { kind: 'string', value: token.parts[0], ...place };
      const parts = token.parts.map(part => (typeof part === 'string' ? { kind: 'string', value: part, ...place } : parser(part.tokens).templatePart()));
      return { kind: 'template', parts, ...place };
    }
    if (at('true') || at('false')) { next(); return { kind: 'bool', value: token.type === 'true', ...place }; }
    if (at('name')) {
      next();
      if (!at('(')) return { kind: 'name', name: token.value, ...place };
      next();
      const args = [];
      while (!at(')')) {
        if (args.length) expect(',', "Separate values with ','");
        args.push(expression());
      }
      next();
      return { kind: 'call', name: token.value, args, ...place };
    }
    if (at('(')) {
      next();
      const inner = expression();
      expect(')', "Expected ')' here");
      return inner;
    }
    return fail('Expected a value here, like a number, a name or "text"');
  }

  return {
    program() {
      const functions = [];
      skipBreaks();
      while (!at('eof')) {
        if (!at('fn')) fail('Code must be inside a function. Start with: fn main { }');
        functions.push(fn());
        skipBreaks();
      }
      return { functions };
    },
    /** One {expression} inside "text". */
    templatePart() {
      const value = expression();
      if (!at('eof')) fail("Only one value fits inside { } in text");
      return value;
    }
  };
}
