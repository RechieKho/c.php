# Remaining Tasks

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

Nothing below is implemented yet. Items marked **(verify)** are assumptions to test before building on them.

## Milestone 0: Spike (1-2 days)

Goal: de-risk assumptions before building anything large.

- [ ] Minimal `bin/cphp.php`: expand, emit `#line`, write depfile
- [ ] `cmake/CPhp.cmake`: `cphp_add_sources()` builds `tests/example-project` on a clean checkout
- [ ] TextMate grammar for `*.c.php` (embed `source.php` in `<?php ?>`, `source.c` elsewhere) in `editor/vscode/`
- [ ] `$gcc` problem matcher: errors click through to the template
- [ ] **(verify)** clangd accepts `didOpen`/`didChange` for a compile-DB path whose content is not on disk
- [ ] **(verify)** how clangd picks flags for a virtual/sibling URI
- [ ] **(verify)** clangd's handling of `#line` for LSP positions (assumed ignored)
- [ ] **(verify)** `CMAKE_EXPORT_COMPILE_COMMANDS` behavior when set from a FetchContent subproject
- [ ] **(verify)** `DEPFILE` support across generators on the minimum CMake version

## Milestone 1: Solid build integration

- [ ] `.map` source map output; PHP errors mapped to template lines
- [ ] `find_package(cphp)` support alongside FetchContent
- [ ] Version check between expander and editor tooling
- [ ] Clear error when PHP is missing; opt-in static php-cli download (**verify** sourcing)

## Milestone 2: LSP proxy, C side only

- [ ] Shadow generator (`bin/cphp-shadow.php`) + stdio proxy forwarding to clangd
- [ ] VS Code client (~100 lines) + grammar + problem matcher packaged as `.vsix`
- [ ] Auto-discovery: `cmake.buildDirectory` / `_deps/cphp-src` / `compile_commands.json`, zero config

## Milestone 3: PHP side and polish

- [ ] PHP shadow routed to Intelephense/Phpactor; merged diagnostics
- [ ] Generated-header convention for declarations
- [ ] Debugger source mapping docs; formatter policy
- [ ] Publish to VS Code Marketplace and Open VSX; CI builds `.vsix` on release

## Cross-cutting

- [ ] Golden corpus + `tests/run-golden.php` (expander and shadows)

## Later

- Neovim / Helix / Zed setup guides
- Run-on-save only, gated by Workspace Trust
- Windows/MSVC
