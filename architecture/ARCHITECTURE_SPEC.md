# Architecture Specification

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info (superseded design, resolved assumptions) to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

Status: expander and CMake function implemented; editor tooling is design only. Items marked **(verify)** are unconfirmed assumptions tracked in [`../remaining_tasks/REMAINING_TASKS.md`](../remaining_tasks/REMAINING_TASKS.md).

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
| Tests | `tests/golden/`, `tests/run-golden.php`, `tests/example-project/` | Shared corpus (`<name>.expected`, `.shadow-c`, `.shadow-php`; `--update` regenerates); clean-checkout build test |

### Invariant

The expander and shadow generator share **one tokenizer** (`PhpToken::tokenize`) and **one golden corpus**, so build and editor never disagree about template meaning.

## 4. Build pipeline

```
foo.c.php --(php cphp.php)--> <build>/cphp/foo.c --(cpp)--> --(cc)--> foo.o
                 |
                 +--> foo.c.d    depfile (PHP include/require deps)
                 +--> foo.c.map  generated-line -> template-line map
```

- `add_custom_command(... DEPFILE ...)`; integrates with Ninja/Make and appears in `compile_commands.json`. Visual Studio generators ignore `DEPFILE`; see section 8.1.
- The expander emits `#line N "foo.c.php"` (absolute, forward-slash path) at line starts where output drifts from the template, and records each in `foo.c.map` (JSON: `lines: [[generated_line, template_line], ...]`). PHP errors print as `file:line: error: msg` with the template line.
- Implementation: the template is tokenized with `PhpToken::tokenize` into a PHP program with identical line layout; literal text goes through `cphp_emit()`; the program runs via `eval`.
- PHP runs with `-d short_open_tag=0` so a stray `<?` in C is not treated as PHP.
- Newline counts are preserved (PHP swallows the newline after `?>`), keeping PHP errors on the correct line.
- Output path is deterministic: `${CMAKE_CURRENT_BINARY_DIR}/cphp/<relpath-without-.php>`, with `<relpath>` relative to `CMAKE_CURRENT_SOURCE_DIR`. It is scoped to the calling directory, not the top-level build, so two projects that both have `src/util.c.php` cannot collide. Editor tooling relies on this to find compile flags.

### CMake API

```cmake
cphp_add_sources(<target> <template>...)   # expands templates, adds outputs to <target>
```

```cmake
cphp_export_php(<target> DIRECTORY <dir> [NAME <lib>])   # share PHP files with consumers (section 4.1)
cphp_export_headers(<target> [DESTINATION <dir>])   # expose PHP-generated headers to consumers (section 5)
cphp_use_composer(<target> [JSON <composer.json>] [LOCK <composer.lock>] [ALLOW_SCRIPTS])   # Composer packages (section 4.3)
```

Version check: `bin/cphp.php --version` must equal the module's `CPHP_VERSION`, else configure fails.

Requirements: CMake >= 3.20, PHP >= 8.0 CLI, a C compiler.

### 4.1 Sharing PHP across projects

A project can export PHP files (helpers, macros, code generators) so that any project linking to it can use them from its own `*.c.php` templates. Works over `FetchContent`, `add_subdirectory`, and installed packages.

**Producer**

```cmake
add_library(mylib ...)                         # or add_library(mylib INTERFACE) for PHP-only
cphp_export_php(mylib DIRECTORY php NAME mylib)
```

- `cphp_export_php` records `NAME=<real path>` in the plain target property `CPHP_LIBS` (in-tree use), and appends a `$<0:cphp:NAME=$<BUILD_INTERFACE:abs>$<INSTALL_INTERFACE:$<INSTALL_PREFIX>/share/cphp/NAME>>` entry to `INTERFACE_LINK_LIBRARIES`. CMake forbids genex in exported custom properties and reserves `INTERFACE_*` for export, so the `$<0:...>` entry (evaluates to nothing at build time) is how the install path reaches imported targets from `find_package`.
- `NAME` defaults to the target name and must be unique within the build graph. The same NAME resolving to the same real path (normalized, symlinks resolved) is fine; a different path is a configure error.
- `install(TARGETS ... EXPORT)` users also get `install(DIRECTORY <dir> DESTINATION share/cphp/NAME)` from the function when `CPHP_INSTALL` is on (default on if the target is installed).

**Consumer**

```cmake
target_link_libraries(app PRIVATE mylib)       # no extra cphp call
cphp_add_sources(app main.c.php)
```

- `cphp_add_sources` collects libs over the target's link closure and passes each to the expander as `--lib NAME=path`. Libraries must be linked **before** `cphp_add_sources`; a deferred end-of-directory check makes a late link a configure error.
- Templates import by logical name, never by path: `<?php require_once cphp('mylib/macros.php'); ?>`. The expander defines `cphp()` to resolve `NAME/rel` against the registered libs. A missing lib or file is a PHP error with the template line. Own-project helpers still use plain relative `require`.
- Every resolved file is written to the depfile, so editing a producer's PHP re-expands consumers.
- Library names give each producer its own namespace, so two libs can both ship `macros.php`.

**Collection.** `cphp_add_sources` walks the link closure itself (`LINK_LIBRARIES` of the target, `INTERFACE_LINK_LIBRARIES` transitively, through `$<LINK_ONLY:>`/`$<BUILD_INTERFACE:>` wrappers). A genex over a custom property is not used: custom properties are not transitive before CMake 3.30. Do not piggyback on `INTERFACE_INCLUDE_DIRECTORIES`, which would leak PHP dirs into C `-I`.

**Editor**

- At generate time CMake writes `<binary-dir>/cphp/libs.json` (`file(GENERATE)`, one per directory that calls `cphp_add_sources`): `{"cphpVersion": ..., "libs": {NAME: path}}`. Tooling compares `cphpVersion` with its own: the extension passes its version to the proxy (`--cphp-version`), which shows a one-time warning on mismatch. The proxy reads it to resolve `cphp('...')` for go-to-definition and to add the dirs to the PHP shadow's include paths for Intelephense/Phpactor.
- Shadows treat `cphp('x/y.php')` as an ordinary PHP call. No new syntax.

**Trust:** exported PHP runs at consumer build time, with the same trust as any fetched `CMakeLists.txt`.

### 4.2 One copy (diamond dependencies)

Exactly one copy of c.php exists per build. c.php is a thin bridge between the two languages, so there is no version negotiation.

- **Guard.** The root `CMakeLists.txt` returns early if c.php is already loaded. Use the name `cphp` for `FetchContent` everywhere; the first declaration wins and later ones are ignored.
- **Who wins.** The top-level project's declaration runs first. A dependency's declaration only applies if nobody declared earlier. Users who need a different version pin it at the top level (or set `FETCHCONTENT_SOURCE_DIR_CPHP`).
- No `cphp_require`, no compatibility checks. A library that needs a newer c.php than the one that won fails on a missing function or flag, like any other CMake module mismatch.

### 4.3 Composer packages (merged root)

Templates can use Composer packages (`use Twig\Environment;` etc.). Every project in a target's link closure may contribute packages. Composer's own solver resolves the combined set, so version conflicts are caught or solved at configure time and the target gets **one vendor dir and one autoloader**.

```cmake
cphp_use_composer(mylib)     # mylib/composer.json takes part in resolution; consumers that link mylib inherit it
cphp_use_composer(app)       # app/composer.json + everything inherited from linked libs
cphp_add_sources(app main.c.php)
```

- **Participants.** `cphp_use_composer(<t>)` registers `<t>`'s `composer.json` directory on the target as `CPHP_COMPOSER` (collected by walking the link closure like `CPHP_LIBS` in 4.1; the same `INTERFACE_*`/genex export limits apply, so carry install paths the same way). Each participant's `composer.json` must have a `name`.
- **Merged root.** For each target that calls `cphp_add_sources`, CMake generates `<binary-dir>/cphp/composer/<hash>/composer.json` (hash of participants + lock path + `ALLOW_SCRIPTS`; targets with identical inputs share a root). Participants are **staged as copies** (`*.php` + `composer.json` + everything its `autoload` `files`/`classmap`/`psr-4`/`psr-0` entries name, whatever the extension; excluding `vendor/`, `.git/`, `node_modules/` and the build tree) under `<root>/participants/<name>/` and referenced as `path` repositories by **relative** URL (`symlink: false`), required as `<name>: @dev`, `minimum-stability: dev`, `prefer-stable: true`. The root's `extra.cphp.participants` holds a fingerprint of every participant's `composer.json`. Staging makes Composer's lock content-hash machine-independent (it covers `repositories`, so absolute paths would break committed locks) and gives the path packages a stable version regardless of the source tree's git state; the fingerprint is how a changed participant `composer.json` makes the lock stale (Composer only hashes the root). The participant's own `require`, `autoload` and `repositories` are resolved by Composer.
- **Lock.** Only the target's owning project has a lock: `LOCK`, default `<source-dir>/composer.lock`, committed. Libraries' own locks are ignored, as in Composer itself. A missing lock is a configure error unless `CPHP_COMPOSER_UPDATE=ON`, which runs `composer update` and rewrites the lock (the option is a cache variable: turn it off again afterwards). A stale lock is detected with `composer validate --check-lock` and is a configure error with the same remedy. Any change to a participant's `composer.json`, even cosmetic, makes the lock stale. The target that calls `cphp_add_sources` must itself call `cphp_use_composer` (it owns the lock).
- **Install.** `composer install --no-interaction --no-dev --no-scripts --no-plugins` at configure time with the vendor dir in the build tree (`<root>/vendor`); skipped when the stamp (root json + lock + hashes of all participant files) matches, otherwise `vendor/` and `participants/` are wiped and rebuilt (Composer will not re-copy a locked path package). The lock, `composer.json` files and participant `*.php` files are `CMAKE_CONFIGURE_DEPENDS`, so editing one re-runs configure on the next build. The expansion command depends on `<root>/cphp-install.stamp`, so a reinstall re-expands.
- **Composer itself.** `find_program(composer)` (`CPHP_COMPOSER_EXECUTABLE`). Missing -> configure error with install hint. Projects that never call `cphp_use_composer` never need it.
- **Autoload.** The expander gets `--autoload <vendor>/autoload.php` and requires it before the template.
- **Conflicts.** Reported by Composer's solver at configure time ("cannot be resolved", with the constraint chain). Fix by loosening a participant's constraint or pinning in the owning project's `composer.json`.
- **Depfile.** Vendor files are filtered out of the depfile by the expander; the lock and `composer.json` files drive reinstall and re-expansion through CMake.
- **Editor.** `libs.json` has a `vendors` array (each merged root's `vendor/` dir); at startup the proxy passes lib dirs and vendor dirs to the PHP server as extra workspace folders so it indexes them.
- **Trust.** Scripts and plugins are off by default (`ALLOW_SCRIPTS` opts in). Packages still run arbitrary PHP at build time (section 7).

## 5. Editor tooling: shadow documents

For each template the proxy derives two virtual documents with **identical length and line/column layout**, so position mapping is the identity.

| Shadow | Content | Fed to |
|---|---|---|
| C shadow | PHP blocks -> spaces (newlines kept); `<?= $x ?>` -> same-width placeholder identifier | clangd |
| PHP shadow | C text -> spaces, PHP kept | Intelephense / Phpactor |

- Position requests (completion, hover, definition, signature help, references, rename, highlight) are routed by cursor region: the PHP server receives the PHP shadow under the template's own URI (`--phpls`). Document symbols are requested from both servers and merged (sorted by line). `textDocument/semanticTokens/full` is requested from both servers and merged: the legend is clangd's plus any PHP types/modifiers it lacks, PHP token indices are remapped, tokens are sorted and delta re-encoded (shadows preserve layout, so positions need no mapping; `range` and `delta` are not advertised when the PHP server is on). Code actions currently come from clangd only. The extension runs one client (proxy + clangd) per workspace folder.
- Diagnostics from both servers are merged.

### Layers

1. **Live**: clangd on the C shadow, as you type.
2. **On save / build**: real expansion, with `#line`-aware problem matchers and debugger support.
3. **Declarations in real headers**: PHP-generated functions/structs/enums are emitted to a generated `.h`; shadows only need to understand function bodies. A `foo.h.php` passed to `cphp_add_sources` expands to `<build>/cphp/foo.h` and the `cphp/` output root is added as a `PRIVATE` include directory of that target (include as `"foo.h"`, subdirectories preserved). `cphp_export_headers(<target> [DESTINATION <dir>])` makes it `PUBLIC` (`BUILD_INTERFACE`) with `INSTALL_INTERFACE <dir>` (default `include`) and installs the generated headers there. Debugging and formatting policy: `docs/DEBUGGING.md`, `docs/FORMATTING.md`.

## 6. Discovery

Activation: the extension activates on opening a `*.c.php` file (`onLanguage`), not on workspace scans.

Zero-config goal: locate `cmake.buildDirectory`, `_deps/cphp-src`, and `compile_commands.json`; derive compile flags for a template from its deterministic generated sibling.

### 6.1 `cphp_setup_vscode()`

```cmake
cphp_setup_vscode([INSTALL] [EDITORS code code-insiders cursor codium])
```

Called from a project's `CMakeLists.txt`. It is a no-op unless the project is top-level and not running in CI (`CI` env var set) or `CPHP_VSCODE_SETUP=OFF`.

1. **Recommend** (always): merge the extension ID into `.vscode/extensions.json` `recommendations`, creating the file if missing. Existing entries are preserved; the file is never rewritten if the ID is already there.
2. **Install** (opt-in: the `INSTALL` argument or cache option `CPHP_VSCODE_AUTO_INSTALL=ON`, default OFF), at configure time:
   - Find each editor CLI in `EDITORS` (default: `code`, `code-insiders`, `cursor`, `codium`) with `find_program`. None found -> skip silently with a `STATUS` message.
   - `<cli> --list-extensions --show-versions` -> if the extension is installed at version >= the one shipped with the fetched c.php, do nothing.
   - Otherwise `<cli> --install-extension <id>@<ver> --force`. No `.vsix` is shipped in the fetched tree; an offline or failed install is a warning. `codium` uses Open VSX; the others use the VS Code Marketplace.
   - Failures are warnings, never configure errors. A stamp file `<build>/cphp/vscode-setup.stamp` (editor + version) avoids re-running on every configure.
3. The install is a side effect outside the build tree, so it is never on by default, never runs from a nested (non-top-level) project, and the status line names the editor and version it installed.

The extension ID is `CPHP_VSCODE_EXTENSION_ID`, default `rechiekho.cphp` (publisher matches the GitHub owner; change before first publish if needed). Distribution is Marketplace and Open VSX only; a GitHub-release `.vsix` download may be added later if offline use matters.

## 7. Security

Expansion executes arbitrary PHP. Treat templates as build scripts. Editor-triggered expansion must be gated by VS Code Workspace Trust.

## 8. Known limitations (by design)

- PHP-built names (`<?= $name ?>_init()`) are placeholders in the live view; real diagnostics arrive after expansion. An echo between two operands (`a <?= $op ?> b`) gets a `+` placeholder instead of an identifier (heuristic: operand-end after whitespace on the left, operand-start on the right, left word not a keyword). A unary position (`return <?= $op ?> b`) cannot be told from a value and still shows a false error.
- C inside loops/conditionals is analyzed once, not per iteration.
- C braces must be balanced within each PHP branch.
- clang-format is unsafe on the shadow; formatting disabled or limited to PHP-free regions.

### 8.1 Windows / MSVC (designed in from the start)

- **Paths.** `#line`, depfiles, maps and `libs.json` always use forward slashes. `#line` filenames escape backslashes and quotes if any remain. Comparisons are case-insensitive on Windows. Depfile drive letters are currently left unescaped (Ninja's parser accepts `C:/`); **(verify)** for Makefile generators.
- **Line endings.** The expander and shadows handle `\r\n`: newline counts are preserved per physical line, and a `\r\n` after `?>` is swallowed as one unit. Shadows keep the original newline bytes so offsets stay identical. LSP columns are UTF-16 code units on all platforms.
- **Generators.** Ninja and Makefile generators use `DEPFILE`. Visual Studio generators ignore it: PHP includes are not tracked, so only listed `DEPENDS` trigger re-expansion. `cphp_add_sources` warns once and recommends Ninja. `CMAKE_GENERATOR` is otherwise not constrained.
- **Commands.** `add_custom_command` uses `VERBATIM`; PHP is invoked as `php.exe` found by `find_program`. Editor CLIs on Windows are `code.cmd`/`cursor.cmd`; Composer is `composer.bat`/`composer.phar` run via php.
- **Diagnostics.** The MSVC problem matcher (`$cphp-msvc`) is shipped alongside `$cphp-gcc` (VS Code's built-in `$gcc`/`$msCompile` cannot be redefined); `/FC` is recommended so paths are absolute. PDB stepping follows `#line` as on other platforms.
- **LSP.** URIs are `file:///c%3A/...`; the proxy normalizes drive letters and case before mapping a template to its generated sibling. clangd with `clang-cl` compile commands is the supported path for MSVC-flavoured flags.
- **Symlinks.** Not relied on (Composer path repos use `symlink: false`).

## 9. Open assumptions (verify)

Verified clangd behaviour is archived in [`archive/2026-10-26-clangd-assumptions.md`](archive/2026-10-26-clangd-assumptions.md). Design consequences: the proxy sends the C shadow to clangd under the generated sibling URI (exact compile-DB flags), maps URIs both ways, and treats positions as physical (`#line` ignored). `cphp_add_sources` sets the target property `EXPORT_COMPILE_COMMANDS`, because the variable does not propagate from a FetchContent subproject.

- `DEPFILE` support across generators at the minimum CMake version (known: not honored by Visual Studio generators).
- Windows: CRLF handling around `?>`, depfile drive-letter escaping per generator, clangd + `clang-cl` flag derivation for a sibling URI.
