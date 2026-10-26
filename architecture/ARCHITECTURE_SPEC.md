# Architecture Specification

Status: design stage. Items marked **(verify)** are unconfirmed assumptions tracked in [`../remaining_tasks/REMAINING_TASKS.md`](../remaining_tasks/REMAINING_TASKS.md).

## 1. Purpose

Use PHP as the preprocessor for C sources (`*.c.php`), expanded by a pre-compile step in CMake, with editor tooling that understands both languages in a single file.

## 2. Goals

1. Plug-and-play CMake: `FetchContent` (or `add_subdirectory`), call one function, build.
2. Strong VS Code experience: completion, hover, go-to-definition, diagnostics, semantic highlighting in both languages.
3. Diagnostics and debugger stepping map back to the template (`foo.c.php`), not the generated file.
4. Editor-agnostic core: tooling is a standalone stdio LSP proxy.

## 3. Components

| Component | Path | Responsibility |
|---|---|---|
| CMake project | `CMakeLists.txt` | Locates PHP, includes the module; usable via `FetchContent` or `add_subdirectory` |
| CMake module | `cmake/CPhp.cmake` | `cphp_add_sources()`, optional `cphp_setup_vscode()` |
| Expander | `bin/cphp.php` | Template -> C: expand, emit `#line`, write depfile and source map |
| Shadow generator | `bin/cphp-shadow.php` | Template -> C shadow and PHP shadow |
| LSP proxy | `editor/lsp-proxy/` | Routes LSP requests to clangd and a PHP language server |
| VS Code extension | `editor/vscode/` | Thin client, TextMate grammar, problem matchers, `.vsix` packaging |
| Tests | `tests/golden/`, `tests/example-project/` | Shared corpus; clean-checkout build test |

### Invariant

The expander and shadow generator share **one tokenizer** (`PhpToken::tokenize`) and **one golden corpus**, so build and editor never disagree about template meaning.

## 4. Build pipeline

```
foo.c.php --(php cphp.php)--> <build>/cphp/foo.c --(cpp)--> --(cc)--> foo.o
                 |
                 +--> foo.c.d    depfile (PHP include/require deps)
                 +--> foo.c.map  generated-line -> template-line map
```

- `add_custom_command(... DEPFILE ...)`; integrates with Ninja/Make and appears in `compile_commands.json`.
- The expander emits `#line N "foo.c.php"` so compiler errors and debugger steps point at the template.
- PHP runs with `-d short_open_tag=0` so a stray `<?` in C is not treated as PHP.
- Newline counts are preserved (PHP swallows the newline after `?>`), keeping PHP errors on the correct line.
- Output path is deterministic: `<build>/cphp/<relpath-without-.php>`. Editor tooling relies on this to find compile flags.

### CMake API

```cmake
cphp_add_sources(<target> <template>...)   # expands templates, adds outputs to <target>
```

Requirements: CMake >= 3.20, PHP >= 8.0 CLI, a C compiler.

## 5. Editor tooling: shadow documents

For each template the proxy derives two virtual documents with **identical length and line/column layout**, so position mapping is the identity.

| Shadow | Content | Fed to |
|---|---|---|
| C shadow | PHP blocks -> spaces (newlines kept); `<?= $x ?>` -> same-width placeholder identifier | clangd |
| PHP shadow | C text -> spaces, PHP kept | Intelephense / Phpactor |

- Requests (completion, hover, definition, signature help, rename, semantic tokens) are routed by cursor region.
- Diagnostics from both servers are merged.

### Layers

1. **Live**: clangd on the C shadow, as you type.
2. **On save / build**: real expansion, with `#line`-aware problem matchers and debugger support.
3. **Declarations in real headers**: PHP-generated functions/structs/enums are emitted to a generated `.h`; shadows only need to understand function bodies.

## 6. Discovery

Zero-config goal: locate `cmake.buildDirectory`, `_deps/cphp-src`, and `compile_commands.json`; derive compile flags for a template from its deterministic generated sibling.

## 7. Security

Expansion executes arbitrary PHP. Treat templates as build scripts. Editor-triggered expansion must be gated by VS Code Workspace Trust.

## 8. Known limitations (by design)

- PHP-built names (`<?= $name ?>_init()`) are placeholders in the live view; real diagnostics arrive after expansion.
- C inside loops/conditionals is analyzed once, not per iteration.
- C braces must be balanced within each PHP branch.
- clang-format is unsafe on the shadow; formatting disabled or limited to PHP-free regions.

## 9. Open assumptions (verify)

- clangd accepts `didOpen`/`didChange` for a compile-DB path whose content is not on disk.
- How clangd picks flags for a virtual/sibling URI.
- clangd ignores `#line` for LSP positions.
- `CMAKE_EXPORT_COMPILE_COMMANDS` behavior when set from a FetchContent subproject.
- `DEPFILE` support across generators at the minimum CMake version.
