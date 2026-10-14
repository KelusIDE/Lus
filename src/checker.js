import { KelError } from './lexer.js';

const MAX_INT = 2n ** 63n - 1n;
const BUILTINS = new Set(['int', 'float', 'len']);
const SHOWABLE = new Set(['int', 'float', 'bool', 'str']);

export function check(program) {
  const functions = new Map();
  for (const fn of program.functions) {
    if (BUILTINS.has(fn.name)) throw new KelError(`'${fn.name}' is built into Kel. Pick another name`, fn.line, fn.col);
    if (functions.has(fn.name)) throw new KelError(`There are two functions named '${fn.name}'`, fn.line, fn.col);
    functions.set(fn.name, fn);
  }
  const main = functions.get('main');
  if (!main) throw new KelError('Every Kel program needs a main function. Add: fn main { }', 1, 1);
  if (main.params.length || main.returns !== 'void') throw new KelError('main takes nothing and returns nothing: fn main { }', main.line, main.col);
  for (const fn of program.functions) checkFunction(fn, functions);
  return program;
}

function checkFunction(fn, functions) {
  const fail = (message, node) => { throw new KelError(message, node.line, node.col); };
  const scopes = [new Map()];
  fn.locals = [];
  const slot = (type) => fn.locals.push(type) - 1;
  const declare = (name, type, mutable, node) => {
    if (scopes.at(-1).has(name)) fail(`'${name}' already exists here. Pick another name, or change it with: ${name} = ...`, node);
    const variable = { type, mutable, local: slot(type) };
    scopes.at(-1).set(name, variable);
    return variable;
  };
  const lookup = (name, node) => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name);
    return fail(`There is no variable named '${name}'. Make one with: let ${name} = ...`, node);
  };
  for (const param of fn.params) declare(param.name, param.type, false, param);

  function expr(node) {
    switch (node.kind) {
      case 'int':
        if (BigInt(node.value) > MAX_INT) fail('This number is too big for an int', node);
        return (node.type = 'int');
      case 'float': return (node.type = 'float');
      case 'bool': return (node.type = 'bool');
      case 'string': return (node.type = 'str');
      case 'template':
        for (const part of node.parts) if (!SHOWABLE.has(expr(part))) fail('This has no value to put in the text', part);
        return (node.type = 'str');
      case 'name': {
        const variable = lookup(node.name, node);
        node.local = variable.local;
        return (node.type = variable.type);
      }
      case 'unary': {
        const type = expr(node.value);
        if (node.op === '!' && type !== 'bool') fail(`'!' flips true/false values, not ${type}`, node);
        if (node.op === '-' && type !== 'int' && type !== 'float') fail(`'-' works on numbers, not ${type}`, node);
        return (node.type = type);
      }
      case 'binary': return (node.type = binary(node));
      case 'call': return (node.type = call(node));
    }
    return fail('Kel does not understand this expression', node);
  }

  function binary(node) {
    const left = expr(node.left);
    const right = expr(node.right);
    const op = node.op;
    if (op === '&&' || op === '||') {
      if (left !== 'bool' || right !== 'bool') fail(`'${op}' joins two true/false values`, node);
      return 'bool';
    }
    if (left !== right) {
      let hint = '';
      if ((left === 'int' && right === 'float') || (left === 'float' && right === 'int')) hint = ' Convert one side with float(x) or int(x)';
      if (op === '+' && (left === 'str' || right === 'str')) hint = ' To mix text and values, use a template: "Score: {score}"';
      fail(`Can't use '${op}' between ${left} and ${right}.${hint}`, node);
    }
    if (op === '==' || op === '!=') return 'bool';
    if (left === 'str') {
      if (op === '+') return 'str';
      fail(`'${op}' doesn't work on text`, node);
    }
    if (left === 'bool') fail(`'${op}' works on numbers, not true/false values`, node);
    if (op === '%' && left === 'float') fail("'%' works on int only", node);
    return ['<', '<=', '>', '>='].includes(op) ? 'bool' : left;
  }

  function call(node) {
    const types = node.args.map(expr);
    const count = (n) => { if (types.length !== n) fail(`${node.name}() takes ${n} value${n === 1 ? '' : 's'}, but got ${types.length}`, node); };
    if (node.name === 'print' && !functions.has('print')) fail('Kel shows things with say, like: say x', node);
    if (node.name === 'int' || node.name === 'float') {
      count(1);
      if (types[0] !== 'int' && types[0] !== 'float') fail(`${node.name}() converts numbers, not ${types[0]}`, node);
      node.builtin = `${types[0]}_to_${node.name}`;
      return node.name;
    }
    if (node.name === 'len') {
      count(1);
      if (types[0] !== 'str') fail(`len() measures text, not ${types[0]}`, node);
      node.builtin = 'len';
      return 'int';
    }
    const target = functions.get(node.name);
    if (!target) fail(`There is no function named '${node.name}'`, node);
    count(target.params.length);
    target.params.forEach((param, i) => {
      if (types[i] !== param.type) fail(`'${param.name}' of ${node.name}() needs ${param.type}, but got ${types[i]}`, node.args[i]);
    });
    return target.returns;
  }

  function condition(node, what) {
    const type = expr(node);
    if (type !== 'bool') fail(`${what} needs a true/false value, but this is ${type}. Did you mean something like x == 0?`, node);
  }
  function whole(node, what) {
    const type = expr(node);
    if (type !== 'int') fail(`${what} needs a whole number (int), but this is ${type}`, node);
  }

  function statements(list, setup) {
    scopes.push(new Map());
    setup?.();
    for (const node of list) statement(node);
    scopes.pop();
  }

  function statement(node) {
    switch (node.kind) {
      case 'let': {
        const type = expr(node.value);
        if (type === 'void') fail('This has no value to store', node.value);
        if (node.declared && node.declared !== type) fail(`'${node.name}' is declared as ${node.declared}, but the value is ${type}`, node);
        node.local = declare(node.name, type, node.mutable, node).local;
        return;
      }
      case 'assign': {
        const variable = lookup(node.name, node);
        if (!variable.mutable) fail(`'${node.name}' was made with let, so it can't change. Use var ${node.name} = ... if it needs to change`, node);
        const type = expr(node.value);
        if (type !== variable.type) fail(`'${node.name}' holds ${variable.type}, so it can't be set to ${type}`, node);
        node.local = variable.local;
        return;
      }
      case 'say':
        if (!SHOWABLE.has(expr(node.value))) fail('This has no value to say', node.value);
        return;
      case 'if':
        condition(node.condition, 'if');
        statements(node.then);
        statements(node.otherwise);
        return;
      case 'while':
        condition(node.condition, 'while');
        statements(node.body);
        return;
      case 'repeat':
        whole(node.count, 'repeat');
        node.counter = slot('int');
        node.limit = slot('int');
        statements(node.body);
        return;
      case 'for':
        whole(node.from, 'for');
        whole(node.to, 'for');
        node.limit = slot('int');
        statements(node.body, () => { node.local = declare(node.name, 'int', false, node).local; });
        return;
      case 'return': {
        if (fn.returns === 'void') {
          if (node.value) fail(`${fn.name}() doesn't give back a value. Add -> type after its name to return one`, node);
          return;
        }
        if (!node.value) fail(`${fn.name}() must return ${fn.returns}`, node);
        const type = expr(node.value);
        if (type !== fn.returns) fail(`${fn.name}() returns ${fn.returns}, but this is ${type}`, node.value);
        return;
      }
      case 'expr':
        expr(node.value);
        return;
    }
  }

  statements(fn.body);
  if (fn.returns !== 'void' && !alwaysReturns(fn.body)) {
    throw new KelError(`${fn.name}() can reach its end without returning ${fn.returns}. Add a return at the end`, fn.line, fn.col);
  }
}

function alwaysReturns(list) {
  const last = list.at(-1);
  if (!last) return false;
  if (last.kind === 'return') return true;
  return last.kind === 'if' && alwaysReturns(last.then) && alwaysReturns(last.otherwise);
}
