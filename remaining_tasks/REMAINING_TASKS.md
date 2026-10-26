# Remaining Tasks

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

Open items only; finished work lives in `archive/`. Items marked **(verify)** are assumptions to test before building on them.

## Milestone 0: Spike (1-2 days)

Done items archived in [`archive/2026-10-26-milestone-1a.md`](archive/2026-10-26-milestone-1a.md).

Goal: de-risk assumptions before building anything large.

- clangd spikes done: see `architecture/archive/2026-10-26-clangd-assumptions.md` (only Linux/Windows clangd runs remain unverified).
- Grammar and problem matchers done: [`archive/2026-10-26-milestone-0-editor.md`](archive/2026-10-26-milestone-0-editor.md). Still to verify: matchers in a real VS Code task run (regex unit-tested only).
- `DEPFILE` verified for Ninja and Unix Makefiles (CMake 4.4.2, macOS), see [`archive/2026-10-26-milestone-4.md`](archive/2026-10-26-milestone-4.md). Still to verify: CMake 3.20 itself, Xcode generator
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
- Non-PHP autoload files (`.inc` classmap/files) are staged: done, [`archive/2026-10-26-composer-autoload-extra.md`](archive/2026-10-26-composer-autoload-extra.md). Not covered: `exclude-from-classmap`, `autoload-dev`
- [ ] Test with Composer 2.x minimum version (tested only with 2.10)

## Milestone 2: LSP proxy, C side only

- Shadow generator done: [`archive/2026-10-26-milestone-2a-shadow.md`](archive/2026-10-26-milestone-2a-shadow.md)
- C-side proxy done: [`archive/2026-10-26-milestone-2b-proxy.md`](archive/2026-10-26-milestone-2b-proxy.md). Still open: proxy tests on Linux/Windows. `.h.php` sibling lookup: tried borrowing flags from a same-directory generated `.c`, but clangd's own interpolation already resolved headers' flags in single- and two-target tests, so nothing was shipped (macOS clangd only; revisit if a layout shows missing flags)
- VS Code client, discovery and `.vsix` packaging done: [`archive/2026-10-26-milestone-2c-vscode-client.md`](archive/2026-10-26-milestone-2c-vscode-client.md). Still open: **finish the real VS Code run** (verified 2026-10-26: C diagnostics, hover, definition, semantic tokens, PHP hover/completion/definition, build problem entries, multi-root; remaining: `main.c` go-to-def lands in generated C, echo-name definition peek, Linux/Windows; this also covers the multi-root and esbuild-bundled paths, which were never loaded in VS Code)
- `cphp('lib/file.php')` go-to-definition from `libs.json` done: [`archive/2026-10-26-milestone-2d-libs-json.md`](archive/2026-10-26-milestone-2d-libs-json.md). Still open: nothing
- Auto-discovery, multi-root (one client per folder), esbuild bundle, `cphpVersion` check: done, see [`archive/2026-10-26-milestone-4.md`](archive/2026-10-26-milestone-4.md)

## Milestone 3: PHP side and polish

- PHP shadow routed to a PHP language server, merged diagnostics: done, [`archive/2026-10-26-milestone-3a-php-side.md`](archive/2026-10-26-milestone-3a-php-side.md). Still open: Phpactor run, real VS Code run
- Generated headers + `cphp_export_headers()`, debugger docs, formatter policy, release workflow: done, [`archive/2026-10-26-milestone-3b-polish.md`](archive/2026-10-26-milestone-3b-polish.md). Still open: **actually publish** (needs a Marketplace/Open VSX publisher and `VSCE_PAT`/`OVSX_PAT` secrets; publisher ID `rechiekho` unconfirmed), Phpactor run. Semantic tokens merge done: [`archive/2026-10-26-semantic-tokens.md`](archive/2026-10-26-semantic-tokens.md) (stub-tested only; try it with a real PHP server and VS Code)

## Cross-cutting

- Golden corpus + `tests/run-golden.php` done (Milestone 4). Gotcha-derived cases added (`close-tag-newlines`, `magic-constants`; see [`archive/2026-10-26-golden-gotchas.md`](archive/2026-10-26-golden-gotchas.md)). Ongoing: add a golden case with each bug fix; a CRLF-bytes check on Windows checkouts (`.gitattributes` now marks them `-text`)
- [ ] Windows items above need a real CI run (CI jobs exist, never executed)

## Later

- Neovim / Helix / Zed setup guides: written, untested, see [`docs/EDITORS.md`](../docs/EDITORS.md); verify each in the real editor
- Run-on-save only, gated by Workspace Trust
