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
- [ ] **(verify)** `DEPFILE` support across generators on the minimum CMake version (VS generators known not to)
- [ ] **(verify)** Windows: CRLF around `?>`, depfile drive-letter escaping, clangd + `clang-cl` flags for a sibling URI

## Milestone 1a: Core build and Windows groundwork

Goal: a correct, platform-safe expander and CMake function. Everything else builds on this.

- [ ] Windows/MSVC support per spec 8.1: forward-slash paths everywhere from the first commit, CRLF-safe expander/shadows, `$msCompile` matcher, VS-generator warning, Windows CI job
- [ ] `.map` source map output; PHP errors mapped to template lines
- [ ] `find_package(cphp)` support alongside FetchContent
- [ ] Scope output path to `CMAKE_CURRENT_BINARY_DIR` (currently `CMAKE_BINARY_DIR`/`CMAKE_SOURCE_DIR` in `cmake/CPhp.cmake`)
- [ ] Root `CMakeLists.txt`: early return if c.php is already loaded (spec 4.2)
- [ ] Clear error when PHP is missing; opt-in static php-cli download (**verify** sourcing)

## Milestone 1b: Sharing PHP and editor setup

Goal: libraries share PHP across projects; one-call editor setup.

- [ ] `cphp_export_php()` + transitive `--lib NAME=path` collection + `cphp()` resolver in the expander (spec 4.1)
- [ ] Install/export of PHP dirs; test with two-project FetchContent example (producer PHP lib, consumer app)
- [ ] **(verify)** custom `INTERFACE_CPHP_LIBS` propagates transitively, including for imported targets
- [ ] `cphp_setup_vscode([INSTALL])`: merge `.vscode/extensions.json` recommendation; opt-in install via editor CLI with version check, stamp file, CI/nested-project skip (spec 6.1)
- [ ] Decide extension publisher/ID (Marketplace + Open VSX only; no `.vsix` in the tree)
- [ ] Version check between expander and editor tooling

## Milestone 1c: Composer

Goal: Composer packages via the merged root (spec 4.3). Riskiest part; does not block Milestone 2, so it may slip without holding up the editor work.

- [ ] `cphp_use_composer()`: participants as `INTERFACE_CPHP_COMPOSER`, merged-root generator (path repos, sorted, hashed), locked install into the build dir, `--autoload` in the expander (spec 4.3)
- [ ] Composer tests: package used by a template; two libs with compatible constraints on one package (solved); two with incompatible constraints (clear configure error); stale/missing lock
- [ ] **(verify)** path repos + `@dev` resolve with stable third-party packages; stale-lock detection for a generated root; `path` entries in the lock are portable; vendor dir redirect on Composer 2.x

## Milestone 2: LSP proxy, C side only

- [ ] Shadow generator (`bin/cphp-shadow.php`) + stdio proxy forwarding to clangd
- [ ] VS Code client (~100 lines) + grammar + problem matcher packaged as `.vsix`
- [ ] Proxy reads `<build>/cphp/libs.json` for `cphp('lib/file.php')` navigation and PHP include paths
- [ ] Auto-discovery: `cmake.buildDirectory` / `_deps/cphp-src` / `compile_commands.json`, zero config

## Milestone 3: PHP side and polish

- [ ] PHP shadow routed to Intelephense/Phpactor; merged diagnostics
- [ ] Generated-header convention for declarations; `cphp_export_headers()` (spec 5)
- [ ] Debugger source mapping docs; formatter policy
- [ ] Publish to VS Code Marketplace and Open VSX; CI builds `.vsix` on release

## Cross-cutting

- [ ] Golden corpus + `tests/run-golden.php` (expander and shadows)

## Later

- Neovim / Helix / Zed setup guides
- Run-on-save only, gated by Workspace Trust
