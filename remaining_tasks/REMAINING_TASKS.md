# Remaining Tasks

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

Nothing below is implemented yet. Items marked **(verify)** are assumptions to test before building on them.

## Milestone 0: Spike (1-2 days)

Done items archived in [`archive/2026-10-26-milestone-1a.md`](archive/2026-10-26-milestone-1a.md).

Goal: de-risk assumptions before building anything large.

- clangd spikes done: see `architecture/archive/2026-10-26-clangd-assumptions.md` (only Linux/Windows clangd runs remain unverified).
- Grammar and problem matchers done: [`archive/2026-10-26-milestone-0-editor.md`](archive/2026-10-26-milestone-0-editor.md). Still to verify: matchers in a real VS Code task run (regex unit-tested only).
- [ ] **(verify)** `DEPFILE` support across generators on the minimum CMake version (VS generators known not to)
- [ ] **(verify)** Windows: CRLF around `?>`, depfile drive-letter escaping, clangd + `clang-cl` flags for a sibling URI

## Milestone 1a: Core build and Windows groundwork

Goal: a correct, platform-safe expander and CMake function. Everything else builds on this.

- [ ] Windows/MSVC: **verify** on a real Windows run (CI job exists in `.github/workflows/ci.yml`, not yet run); `$msCompile` matcher ships with the VS Code extension; CRLF-safe shadows (expander done)
- [ ] Opt-in static php-cli download (**verify** sourcing); the clear missing-PHP error is done

## Milestone 1b: Sharing PHP and editor setup

Done and archived in [`archive/2026-10-26-milestone-1b.md`](archive/2026-10-26-milestone-1b.md).

- [ ] Verify `cphp_setup_vscode` against real `code`/`codium` CLIs (tested with a fake CLI only); confirm Marketplace/Open VSX ID once the extension is published (**decision pending**: publisher `rechiekho`)
- [ ] Editor-side half of the version check: the proxy/extension compares `libs.json` `cphpVersion` (Milestone 2)
- [ ] Windows run of the two-project test (CI step added, not yet run)

## Milestone 1c: Composer

Done and archived in [`archive/2026-10-26-milestone-1c.md`](archive/2026-10-26-milestone-1c.md).

- [ ] Windows run of Composer paths (`composer.bat`/`.phar` handling, staged copies) and CI on Windows
- [ ] Participants with non-PHP autoload files (e.g. classmap of other extensions) are not staged; extend `_cphp_composer_files` if needed
- [ ] Editor: `libs.json` vendor-dir entry for the proxy (Milestone 2)
- [ ] Test with Composer 2.x minimum version (tested only with 2.10)

## Milestone 2: LSP proxy, C side only

- Shadow generator done: [`archive/2026-10-26-milestone-2a-shadow.md`](archive/2026-10-26-milestone-2a-shadow.md)
- C-side proxy done: [`archive/2026-10-26-milestone-2b-proxy.md`](archive/2026-10-26-milestone-2b-proxy.md). Still open: read `libs.json` (see below), proxy tests on Linux/Windows, `.h.php` sibling lookup (headers are not compiled, so they use the virtual URI)
- VS Code client, discovery and `.vsix` packaging done: [`archive/2026-10-26-milestone-2c-vscode-client.md`](archive/2026-10-26-milestone-2c-vscode-client.md). Still open: **run it in a real VS Code** (only unit/e2e-tested headless), multi-root workspaces (one client for the first folder), bundle with esbuild to shrink the vsix
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
