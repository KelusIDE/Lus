import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, run, KelError } from '../src/index.js';

async function output(source) {
  const lines = [];
  const bytes = compile(source);
  assert.ok(WebAssembly.validate(bytes), 'module must be valid WebAssembly');
  await run(bytes, line => lines.push(line));
  return lines;
}
const example = (name) => readFileSync(new URL(`../examples/${name}.lus`, import.meta.url), 'utf8');
function mistake(source, pattern, line) {
  assert.throws(() => compile(source), (error) => {
    assert.ok(error instanceof KelError, `expected a KelError, got ${error}`);
    assert.match(error.message, pattern);
    if (line) assert.equal(error.line, line, `line for ${pattern}`);
    return true;
  });
}

assert.deepEqual(await output(example('hello')), ['Hello, Kel!', 'Kelus is 15 years old', 'Hip hip hooray!', 'Hip hip hooray!', 'Hip hip hooray!']);
assert.deepEqual((await output(example('fib'))).slice(-2), ['fib(9) = 34', 'fib(10) = 55']);
assert.deepEqual(await output(example('grades')), ['Average: 85.66666666666667', 'Grade: B', 'Rounded down: 85', 'true', "'Kel' has 3 letters"]);
console.log('Examples: OK');

assert.deepEqual(await output(`
fn main {
    say 7 / 2
    say -7 % 3
    say 2.5 * 2.0
    say -(3 - 5)
    say 1 < 2 && 2 < 1
    say !false || false
    say 9_000_000_000 * 1_000_000_000
    say int(-2.9)
    say float(3)
    say "tab\\there \\{not a template\\}"
}
`), ['3', '-1', '5.0', '2', 'false', 'true', '9000000000000000000', '-2', '3.0', 'tab\there {not a template}']);
console.log('Numbers and logic: OK');

assert.deepEqual(await output(`
fn shout(word: str) -> str { return word + "!" }

fn main {
    let name = "Kel"
    var text = ""
    for i in 1..3 { text += "{i}" }
    say text
    say "{name} {len(name)} {1.5} {true} {shout(name)}"
    say name == "Kel"
    say name != "Kel"
    say "" == ""
    say "Kel" == "Ke"
    var long = ""
    repeat 20000 { long += "ab" }
    say len(long)
}
`), ['123', 'Kel 3 1.5 true Kel!', 'true', 'false', 'true', 'false', '40000']);
console.log('Text, templates and memory growth: OK');

assert.deepEqual(await output(`
fn side_effect() -> bool {
    say "ran"
    return true
}

fn main {
    say false && side_effect()
    say true || side_effect()
    var x = 1
    if x == 1 {
        let x = 2
        say x
    }
    else {
        say "no"
    }
    say x
    repeat 0 { say "never" }
    for i in 3..1 { say "never" }
    var total = 0; for i in 1..100 { total += i }; say total
    x *= 5; x -= 1; x /= 2; x %= 3; say x
    say add(
        1,
        2
    )
}

fn add(a: int, b: int) -> int { return a + b }
`), ['false', 'true', '2', '1', '5050', '2', '3']);
console.log('Short-circuit, scopes, loops, wrapping: OK');

await assert.rejects(output('fn main {\n    let zero = 0\n    say 1 / zero\n}\n'), /divided an int by zero/);
console.log('Runtime errors: OK');

mistake('fn main {\n    say 1 + 2.0\n}\n', /between int and float\. Convert one side with float\(x\)/, 2);
mistake('fn main {\n    say "Score: " + 5\n}\n', /use a template: "Score: \{score\}"/, 2);
mistake('fn main {\n    let x = 1\n    x = 2\n}\n', /made with let, so it can't change\. Use var x/, 3);
mistake('fn main {\n    if 1 < 2:\n        say 1\n}\n', /Kel uses \{ \} for blocks/, 2);
mistake('def main():\n    print(1)\n', /Kel makes functions with fn/, 1);
mistake('fn main {\n    print(1)\n}\n', /Kel shows things with say/, 2);
mistake('fn main {\n    if true and false { say 1 }\n}\n', /Kel writes 'and' as &&/, 2);
mistake('fn main {\n    # hello\n}\n', /Comments in Kel start with \/\//, 2);
mistake('fn main {\n    say 1\n', /missing its closing '\}'/, 1);
mistake('fn main {\n    if true\n        say 1\n}\n', /Expected '\{' to start the if block/, 3);
mistake('fn add(a: int, b: int) -> int {\n    let c = a + b\n}\nfn main { say add(1, 2) }\n', /can reach its end without returning int/, 1);
mistake('fn helper { say 1 }\n', /needs a main function/);
mistake('fn main {\n    say total\n}\n', /no variable named 'total'. Make one with: let total/, 2);
mistake('fn main {\n    if 5 { say 1 }\n}\n', /if needs a true\/false value/, 2);
mistake('fn main {\n    say 1 < 2 < 3\n}\n', /Compare two values at a time/, 2);
mistake('fn main {\n    repeat 2.5 { say 1 }\n}\n', /repeat needs a whole number/, 2);
mistake('fn main {\n    for i in 1..3 { i = 5 }\n}\n', /'i' was made with let/, 2);
mistake('fn main {\n    say "Hi {name"\n}\n', /missing its closing '\}'/, 2);
mistake('fn main {\n    say "Hi {nobody}"\n}\n', /no variable named 'nobody'/, 2);
mistake('fn f(a: int) { say a }\nfn main {\n    f(true)\n}\n', /'a' of f\(\) needs int, but got bool/, 3);
mistake('fn main {\n    say 99999999999999999999\n}\n', /too big for an int/, 2);
console.log('Beginner-friendly mistakes: OK');
