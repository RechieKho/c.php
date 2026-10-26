# State

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

Last updated: 2026-10-26

## Summary

Pre-alpha, design stage. Repo scaffolding exists (CMake project skeleton, directory layout, docs); the expander, shadow generator, LSP proxy and VS Code extension are **not implemented**.

## Done

- [x] README, architecture spec, task list, state docs
- [x] Directory layout (`bin/`, `cmake/`, `editor/vscode/`, `editor/lsp-proxy/`, `tests/`)
- [x] CMake project skeleton: `CMakeLists.txt`, `cmake/CPhp.cmake` (`cphp_add_sources`)

## TODO (current focus: Milestone 0 spike)

- [ ] `bin/cphp.php` minimal expander (expand, `#line`, depfile)
- [ ] `tests/example-project` builds on a clean checkout
- [ ] TextMate grammar for `*.c.php`
- [ ] `$gcc` problem matcher
- [ ] Resolve all **(verify)** items (see `remaining_tasks/REMAINING_TASKS.md`)

## Gotchas

- **PHP swallows the newline after `?>`**: the expander must compensate or line numbers drift.
- **`short_open_tag` must be off** (`-d short_open_tag=0`), otherwise `<?` in C is parsed as PHP.
- **Output path is a contract**: `<build>/cphp/<relpath-without-.php>`; editor tooling depends on it.
- **One tokenizer**: expander and shadow generator must both use `PhpToken::tokenize`; do not fork parsing logic.
- **Shadows must preserve length and line/column layout**; any width change breaks identity position mapping.
- **clang-format is unsafe on the C shadow.**
- **`cphp_add_sources` currently fails with a clear error** until `bin/cphp.php` exists.
- **FetchContent + `CMAKE_EXPORT_COMPILE_COMMANDS`**: setting it from a subproject may not propagate (verify).
- **npm project is `editor/vscode/` only**: `node_modules/`, lockfile and `.vsix` stay there; no root `package.json`.
- **Security**: expanding a template runs arbitrary PHP; gate editor-triggered runs behind Workspace Trust.
- License is MIT (`LICENSE`); the copyright holder line is "Richie Kho" — adjust if needed.
