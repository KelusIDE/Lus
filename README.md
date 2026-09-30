<img src="assets/kel-icon.svg" width="96" alt="Kel logo">

# Kel

**Clean `{ }` code with friendly words. Typed like Rust. Compiles to WebAssembly, so it runs in every browser.**

```
fn fib(n: int) -> int {
    if n < 2 { return n }
    return fib(n - 1) + fib(n - 2)
}

fn main {
    let name = "Kel"
    var score = 0
    repeat 3 { score += 10 }
    say "Hi {name}! Score: {score}"
    for i in 1..5 {
        say "fib({i}) = {fib(i)}"
    }
}
```

Kel is a skeleton of a language for beginners. It uses the `{ }` blocks of Rust, Swift and JavaScript
(so what you learn carries over), plus its own beginner-friendly words: `say`, `repeat`, `"{templates}"`.
The compiler is about 800 lines of plain JavaScript with no dependencies. It runs in Node and in the
browser, and turns a Kel file into a real WebAssembly module in a few milliseconds.

## Try it

```sh
node bin/kel.js run examples/hello.lus      # compile and run
node bin/kel.js build examples/fib.lus      # write fib.wasm
node bin/kel.js check examples/primes.lus   # find mistakes without running
npm run play                                # browser playground at http://localhost:5173
npm test
```

## The language so far

| | |
|---|---|
| Functions | `fn add(a: int, b: int) -> int { }` · `fn main { }` is where the program starts |
| Variables | `let x = 1` can't change · `var y = 2` can · the type is worked out for you |
| Types | `int` (64-bit), `float`, `bool`, `str` (text) |
| Showing things | `say x` · `say "Hi {name}, you are {age}"` |
| Loops | `repeat 3 { }` · `for i in 1..10 { }` (1 to 10) · `while x < 10 { }` |
| Choices | `if` / `else if` / `else` |
| Operators | `+ - * / %`, `+= -= *= /= %=`, `== != < <= > >=`, `&& \|\| !` |
| Text | join with `+`, compare with `==`, `len(s)` |
| Built-ins | `int(x)`, `float(x)`, `len(s)` |

Line breaks end statements (no `;` needed), `//` starts a comment, and indentation is up to you.

## Mistakes explain themselves

Every mistake is caught before the program runs, with the line, a `^` under the spot and a fix:

```
main.lus:3:5: 'x' was made with let, so it can't change. Use var x = ... if it needs to change
        x = 2
        ^
main.lus:2:19: Can't use '+' between str and int. To mix text and values, use a template: "Score: {score}"
        say "Score: " + 5
                      ^
```

It also knows habits from other languages: `def`, `print(...)`, `and`/`or`/`not`, `#` comments, and
`if x:` with a colon each get a hint pointing to the Kel way.

## Speed

`fib(38)` (126 million function calls), measured on an M-series Mac. Times include start-up.

| | time |
|---|---|
| C, `clang -O2` (the same class as Rust) | 0.10 s |
| **Kel → WebAssembly** | **0.12 s** |
| JavaScript (Node) | 0.24 s |
| Python | about 3.8 s (estimated: fib(32) took 0.21 s) |

Kel is typed, so it compiles to plain machine-level WebAssembly with nothing checked at run time. The
browser's WebAssembly engine then turns that into native code. On small number-heavy code like this it
is close to C and Rust. It is not Rust-fast in general yet: Kel has no optimizer of its own, and bigger
programs (text, lists, memory) will show the gap. Closing it is on the roadmap.

## How it works

```
source ─ lexer.js ─▶ tokens ─ parser.js ─▶ syntax tree ─ checker.js ─▶ typed tree ─ codegen.js ─▶ .wasm bytes
```

- `src/lexer.js`: text into tokens, including `indent`/`dedent` for blocks
- `src/parser.js`: tokens into a tree (recursive descent)
- `src/checker.js`: types and friendly mistakes; gives each variable a slot
- `src/codegen.js`: writes the WebAssembly binary format directly (`int`→i64, `float`→f64, `bool`→i32; text lives in memory as address + length)
- `src/index.js`: `compile(source)`, `run(bytes)` (which also builds new text on a simple heap) and error formatting
- `bin/kel.js`: command line · `web/`: playground · `tests/run.js`: tests

## Roadmap

1. **Lists:** `[1, 2, 3]`, `for x in list`, `list.add(x)`.
2. **Structs:** `type Point { x: float, y: float }` with methods.
3. **Memory without a garbage collector:** text and lists are owned and freed automatically, with Rust-style safety but none of Rust's lifetimes. Today, new text is never freed.
4. **Input:** `ask("Your name?")`.
5. **Optimizer:** constant folding and inlining, so larger programs get closer to Rust.
6. **The web:** call JavaScript and draw on a canvas from Kel, so beginners can make games that run in a browser.
7. **Tools:** a formatter and a language server. Kelus already colors `.lus` files (Kel + .lus = Kelus).
