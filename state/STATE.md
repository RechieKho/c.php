# State

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

Last updated: 2026-10-26 (Milestone 1c)

## Summary

Pre-alpha. The expander (`bin/cphp.php`) and CMake function work end to end (verified on macOS/Ninja/PHP 8.5). Shadow generator, LSP proxy and VS Code extension are **not implemented**. Milestones 1a (core), 1b (shared PHP, `cphp_setup_vscode`) and 1c (Composer) are done; see `remaining_tasks/archive/2026-10-26-milestone-1{a,b,c}.md`. Next: Milestone 0 editor spike items, then Milestone 2.

## Done

- [x] README, architecture spec, task list, state docs
- [x] Directory layout (`bin/`, `cmake/`, `editor/vscode/`, `editor/lsp-proxy/`, `tests/`)
- [x] CMake project skeleton: `CMakeLists.txt`, `cmake/CPhp.cmake` (`cphp_add_sources`)
- [x] Expander, depfile, source map, `#line`; `tests/example-project` builds and passes ctest
- [x] `find_package(cphp)` via install tree; CI workflow written (untested)
- [x] `cphp_use_composer` (merged root, staged participants, locked install); tested with Composer 2.10
- [x] `cphp_export_php`, `cphp()`, `--lib`, `libs.json`; two-project test (FetchContent and installed); `cphp_setup_vscode`

## TODO (current focus: finish Milestone 0 spike, then 1b)

- [ ] TextMate grammar for `*.c.php`
- [ ] `$gcc` problem matcher
- [ ] Resolve all **(verify)** items (see `remaining_tasks/REMAINING_TASKS.md`)

## Gotchas

- **Composer lock workflow**: first run `-DCPHP_COMPOSER_UPDATE=ON` (cached; turn it off again), commit `composer.lock`. Any participant `composer.json` change (even whitespace) makes it stale. The target calling `cphp_add_sources` must itself call `cphp_use_composer`.
- **Composer participants are staged copies**: only `*.php` and `composer.json` are copied; editing them re-runs configure and reinstalls. Participant dirs are globbed recursively (excluding `vendor/`, `.git/`, build tree): keep them small.

- **PHP libs must be linked before `cphp_add_sources`** (collection happens at call time; a deferred check errors on a late link).
- **Exported lib data rides in `INTERFACE_LINK_LIBRARIES`** as `$<0:cphp:NAME=path>`; do not "clean" it up. Imported consumers need `find_package(<pkg> CONFIG)` (on case-insensitive FS a Find module can shadow it).
- **`CPHP_VERSION` must match `bin/cphp.php`'s `CPHP_VERSION`** (checked at configure).
- **`cphp_setup_vscode`** installs `<id>@<CPHP_VERSION>`, but no extension is published yet, so INSTALL warns until Milestone 2/3.

- **PHP swallows the newline after `?>`**: the expander must compensate or line numbers drift.
- **`short_open_tag` must be off** (`-d short_open_tag=0`), otherwise `<?` in C is parsed as PHP.
- **Output path is a contract**: `${CMAKE_CURRENT_BINARY_DIR}/cphp/<relpath-without-.php>`; editor tooling depends on it.
- **Expander runs the template via `eval`** inside `cphp_run()`; `__DIR__`/`__FILE__` tokens are rewritten to the template's. Variables are function-local. PHP warnings are printed and non-fatal; thrown errors fail the build and delete the output.
- **A PHP `//` comment containing the close tag ends PHP mode**, including inside `bin/cphp.php` itself.
- **Depfile colons are not escaped** (Windows drive letters); unverified for Makefile generators on Windows.
- **`#line` is only emitted at a line start**; mid-line dynamic output can drift the map until the next static chunk.
- **Windows is designed in** (spec 8.1): always emit forward-slash paths in `#line`, depfiles, maps; handle CRLF.
- **One tokenizer**: expander and shadow generator must both use `PhpToken::tokenize`; do not fork parsing logic.
- **Shadows must preserve length and line/column layout**; any width change breaks identity position mapping.
- **clang-format is unsafe on the C shadow.**
- **FetchContent + `CMAKE_EXPORT_COMPILE_COMMANDS`**: setting it from a subproject may not propagate (verify).
- **npm project is `editor/vscode/` only**: `node_modules/`, lockfile and `.vsix` stay there; no root `package.json`.
- **Security**: expanding a template runs arbitrary PHP; gate editor-triggered runs behind Workspace Trust.
- License is MIT (`LICENSE`); the copyright holder line is "Richie Kho" — adjust if needed.
