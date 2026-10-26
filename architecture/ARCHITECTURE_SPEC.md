# Architecture Specification

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info (superseded design, resolved assumptions) to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

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

- `add_custom_command(... DEPFILE ...)`; integrates with Ninja/Make and appears in `compile_commands.json`. Visual Studio generators ignore `DEPFILE`; see section 8.1.
- The expander emits `#line N "foo.c.php"` so compiler errors and debugger steps point at the template.
- PHP runs with `-d short_open_tag=0` so a stray `<?` in C is not treated as PHP.
- Newline counts are preserved (PHP swallows the newline after `?>`), keeping PHP errors on the correct line.
- Output path is deterministic: `${CMAKE_CURRENT_BINARY_DIR}/cphp/<relpath-without-.php>`, with `<relpath>` relative to `CMAKE_CURRENT_SOURCE_DIR`. It is scoped to the calling directory, not the top-level build, so two projects that both have `src/util.c.php` cannot collide. Editor tooling relies on this to find compile flags.

### CMake API

```cmake
cphp_add_sources(<target> <template>...)   # expands templates, adds outputs to <target>
```

```cmake
cphp_export_php(<target> DIRECTORY <dir> [NAME <lib>])   # share PHP files with consumers (section 4.1)
cphp_export_headers(<target> [DIRECTORY <dir>])   # expose PHP-generated headers to consumers (section 5)
cphp_use_composer(<target> [JSON <composer.json>] [LOCK <composer.lock>] [ALLOW_SCRIPTS])   # Composer packages (section 4.3)
```

Requirements: CMake >= 3.20, PHP >= 8.0 CLI, a C compiler.

### 4.1 Sharing PHP across projects

A project can export PHP files (helpers, macros, code generators) so that any project linking to it can use them from its own `*.c.php` templates. Works over `FetchContent`, `add_subdirectory`, and installed packages.

**Producer**

```cmake
add_library(mylib ...)                         # or add_library(mylib INTERFACE) for PHP-only
cphp_export_php(mylib DIRECTORY php NAME mylib)
```

- `cphp_export_php` records `<dir>` on the target as the interface property `INTERFACE_CPHP_LIBS`, holding a `NAME=path` entry, with `$<BUILD_INTERFACE:abs>` for in-tree use and `$<INSTALL_INTERFACE:share/cphp/NAME>` for installed use.
- `NAME` defaults to the target name and must be unique within the build graph. The same NAME resolving to the same real path (normalized, symlinks resolved) is fine; a different path is a configure error.
- `install(TARGETS ... EXPORT)` users also get `install(DIRECTORY <dir> DESTINATION share/cphp/NAME)` from the function when `CPHP_INSTALL` is on (default on if the target is installed).

**Consumer**

```cmake
target_link_libraries(app PRIVATE mylib)       # no extra cphp call
cphp_add_sources(app main.c.php)
```

- `cphp_add_sources` collects `INTERFACE_CPHP_LIBS` over the target's link closure and passes each entry to the expander as `--lib NAME=path`.
- Templates import by logical name, never by path: `<?php require_once cphp('mylib/macros.php'); ?>`. The expander defines `cphp()` to resolve `NAME/rel` against the registered libs. A missing lib or file is a PHP error with the template line. Own-project helpers still use plain relative `require`.
- Every resolved file is written to the depfile, so editing a producer's PHP re-expands consumers.
- Library names give each producer its own namespace, so two libs can both ship `macros.php`.

**Collection.** First try a generator expression over the link closure. Fallback: `cphp_add_sources` walks `INTERFACE_LINK_LIBRARIES` itself. Do not piggyback on `INTERFACE_INCLUDE_DIRECTORIES`, which would leak PHP dirs into C `-I`.

**Editor**

- At generate time CMake writes `<build>/cphp/libs.json` (`file(GENERATE)`), mapping each library NAME to its path. The proxy reads it to resolve `cphp('...')` for go-to-definition and to add the dirs to the PHP shadow's include paths for Intelephense/Phpactor.
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

- **Participants.** `cphp_use_composer(<t>)` registers `<t>`'s `composer.json` directory on the target as `INTERFACE_CPHP_COMPOSER` (build/install interface, collected transitively like `INTERFACE_CPHP_LIBS`). Each participant's `composer.json` must have a `name`.
- **Merged root.** For each target that calls `cphp_add_sources`, CMake generates `<binary-dir>/cphp/composer/<hash>/composer.json`: each participant is a `path` repository (`symlink: false`) required as `<name>: @dev`, `minimum-stability: dev`, `prefer-stable: true`. Participants are sorted so the file is deterministic. Targets with identical participant sets share one root (keyed by hash). The participant's own `require`, `autoload` and `repositories` are resolved by Composer, not by us.
- **Lock.** Only the target's owning project has a lock: `LOCK`, default `<source-dir>/composer.lock`, committed. Libraries' own locks are ignored, as in Composer itself. A missing or stale lock is a configure error unless `CPHP_COMPOSER_UPDATE=ON`, which runs `composer update` and rewrites the lock.
- **Install.** `composer install --no-interaction --no-dev --no-scripts --no-plugins` at configure time with the vendor dir in the build tree; skipped when the stamp (root hash + lock hash) matches. Lock and each participant's `composer.json` are `CMAKE_CONFIGURE_DEPENDS`.
- **Composer itself.** `find_program(composer)` (`CPHP_COMPOSER_EXECUTABLE`). Missing -> configure error with install hint. Projects that never call `cphp_use_composer` never need it.
- **Autoload.** The expander gets `--autoload <vendor>/autoload.php` and requires it before the template.
- **Conflicts.** Reported by Composer's solver at configure time ("cannot be resolved", with the constraint chain). Fix by loosening a participant's constraint or pinning in the owning project's `composer.json`.
- **Depfile.** Vendor files are not listed; the lock and `composer.json` files drive reinstall and re-expansion through CMake.
- **Editor.** `libs.json` lists each target's vendor dir; the proxy adds it to the PHP shadow's include paths for Intelephense/Phpactor.
- **Trust.** Scripts and plugins are off by default (`ALLOW_SCRIPTS` opts in). Packages still run arbitrary PHP at build time (section 7).

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
3. **Declarations in real headers**: PHP-generated functions/structs/enums are emitted to a generated `.h`; shadows only need to understand function bodies. The header directory is `PRIVATE` by default; `cphp_export_headers(<target>)` explicitly exports it to consumers (`BUILD_INTERFACE` for in-tree, `INSTALL_INTERFACE` once installed).

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

The extension ID is `CPHP_VSCODE_EXTENSION_ID` (publisher TBD). Distribution is Marketplace and Open VSX only; a GitHub-release `.vsix` download may be added later if offline use matters.

## 7. Security

Expansion executes arbitrary PHP. Treat templates as build scripts. Editor-triggered expansion must be gated by VS Code Workspace Trust.

## 8. Known limitations (by design)

- PHP-built names (`<?= $name ?>_init()`) are placeholders in the live view; real diagnostics arrive after expansion.
- C inside loops/conditionals is analyzed once, not per iteration.
- C braces must be balanced within each PHP branch.
- clang-format is unsafe on the shadow; formatting disabled or limited to PHP-free regions.

### 8.1 Windows / MSVC (designed in from the start)

- **Paths.** `#line`, depfiles, maps and `libs.json` always use forward slashes. `#line` filenames escape backslashes and quotes if any remain. Comparisons are case-insensitive on Windows. Drive letters are escaped as the generator needs in depfiles (Ninja: `C\:/...`).
- **Line endings.** The expander and shadows handle `\r\n`: newline counts are preserved per physical line, and a `\r\n` after `?>` is swallowed as one unit. Shadows keep the original newline bytes so offsets stay identical. LSP columns are UTF-16 code units on all platforms.
- **Generators.** Ninja and Makefile generators use `DEPFILE`. Visual Studio generators ignore it: PHP includes are not tracked, so only listed `DEPENDS` trigger re-expansion. `cphp_add_sources` warns once and recommends Ninja. `CMAKE_GENERATOR` is otherwise not constrained.
- **Commands.** `add_custom_command` uses `VERBATIM`; PHP is invoked as `php.exe` found by `find_program`. Editor CLIs on Windows are `code.cmd`/`cursor.cmd`; Composer is `composer.bat`/`composer.phar` run via php.
- **Diagnostics.** The MSVC problem matcher (`$msCompile`) is shipped alongside `$gcc`; `/FC` is recommended so paths are absolute. PDB stepping follows `#line` as on other platforms.
- **LSP.** URIs are `file:///c%3A/...`; the proxy normalizes drive letters and case before mapping a template to its generated sibling. clangd with `clang-cl` compile commands is the supported path for MSVC-flavoured flags.
- **Symlinks.** Not relied on (Composer path repos use `symlink: false`).

## 9. Open assumptions (verify)

- clangd accepts `didOpen`/`didChange` for a compile-DB path whose content is not on disk.
- How clangd picks flags for a virtual/sibling URI.
- clangd ignores `#line` for LSP positions.
- `CMAKE_EXPORT_COMPILE_COMMANDS` behavior when set from a FetchContent subproject.
- Composer: `path` repositories with `@dev` + `minimum-stability: dev` resolve cleanly alongside stable third-party packages; `composer install` flags a stale lock for a generated root; lock entries for `path` packages are portable across machines (fallback: only third-party entries are checked).
- Composer: vendor dir redirect (`COMPOSER_VENDOR_DIR` or `config.vendor-dir` in the generated root) on Composer 2.x.
- `DEPFILE` support across generators at the minimum CMake version (known: not honored by Visual Studio generators).
- Windows: CRLF handling around `?>`, depfile drive-letter escaping per generator, clangd + `clang-cl` flag derivation for a sibling URI.
- Custom `INTERFACE_CPHP_LIBS` is collected transitively through `target_link_libraries` via a genex. If not, `cphp_add_sources` walks `INTERFACE_LINK_LIBRARIES` itself. Same question for imported targets from `find_package`.
