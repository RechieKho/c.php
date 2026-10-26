# State

> **Dreaming:** keep this file under 500 lines. After each completed implementation, move inactive info to `archive/<date>-<topic>.md` and link it here. See `/CLAUDE.md`.

Last updated: 2026-10-26 (Milestone 4)

## Summary

Pre-alpha. The expander (`bin/cphp.php`) and CMake function work end to end (verified on macOS/Ninja/PHP 8.5). Shadow generator, LSP proxy and VS Code extension are **not implemented**. Milestones 1a (core), 1b (shared PHP, `cphp_setup_vscode`) and 1c (Composer) are done; see `remaining_tasks/archive/2026-10-26-milestone-1{a,b,c}.md`. Editor scaffold (grammar, matchers) done. Shadow generator done. clangd spikes done (archived in `architecture/archive/2026-10-26-clangd-assumptions.md`). LSP proxy and VS Code client done and packagable, but never run inside real VS Code. Milestone 3a (PHP shadow routed to a PHP language server) done, see `remaining_tasks/archive/2026-10-26-milestone-3a-php-side.md`. Milestone 3 is implemented (3a PHP routing, 3b headers/docs/release workflow; see `remaining_tasks/archive/2026-10-26-milestone-3b-polish.md`) except actually publishing. Milestone 4 (golden corpus, proxy tests in ctest, DEPFILE verification, `cphpVersion` warning, documentSymbol merge, multi-root, esbuild bundle) done, see `remaining_tasks/archive/2026-10-26-milestone-4.md`. Next: manual smoke test in VS Code (the extension has never been loaded there, including the new bundle), Windows CI run, publish, then Later items.

## Done

- [x] README, architecture spec, task list, state docs
- [x] Directory layout (`bin/`, `cmake/`, `editor/vscode/`, `editor/lsp-proxy/`, `tests/`)
- [x] CMake project skeleton: `CMakeLists.txt`, `cmake/CPhp.cmake` (`cphp_add_sources`)
- [x] Expander, depfile, source map, `#line`; `tests/example-project` builds and passes ctest
- [x] `find_package(cphp)` via install tree; CI workflow written (untested)
- [x] `cphp_use_composer` (merged root, staged participants, locked install); tested with Composer 2.10
- [x] VS Code extension scaffold: `cphp` language, TextMate grammar, `cphp-gcc`/`cphp-msvc`/`cphp-php` matchers; `npm test` in `editor/vscode/` (see `remaining_tasks/archive/2026-10-26-milestone-0-editor.md`)
- [x] Shadow generator `bin/cphp-shadow.php` + `tests/shadow-test.php` (ctest `cphp_shadow`)
- [x] C-side LSP proxy `editor/lsp-proxy/cphp-lsp-proxy.js` + e2e test with real clangd
- [x] VS Code client + discovery + `.vsix` packaging (`npm run package` in `editor/vscode/`); C-side diagnostics verified in real VS Code on 2026-10-26 (squiggle on the right `.php` line, macOS); hover, definition, semantic tokens, PHP side, multi-root and tasks still unchecked
- [x] `cphp_export_headers()`, `.h.php` generated headers (two-project test, build tree and installed); `docs/DEBUGGING.md` (lldb verified), `docs/FORMATTING.md`; `breakpoints` + format-off defaults in the extension; `.github/workflows/release.yml` (untested, needs tag + secrets)
- [x] `libs.json` `vendors` array; lib and vendor dirs passed to the PHP server as workspace folders (libs verified with Intelephense; vendor dir path not yet exercised with a real Composer build)
- [x] PHP language server routing in the proxy (`--phpls`, settings `cphp.phpServer`); tested with Intelephense, not yet in real VS Code
- [x] Proxy resolves `cphp('lib/file.php')` go-to-definition via `libs.json` (see `remaining_tasks/archive/2026-10-26-milestone-2d-libs-json.md`)
- [x] Milestone 4: `tests/run-golden.php` + `tests/golden/` (ctest `cphp_golden`), ctest `cphp_proxy`/`cphp_proxy_stub`, `--cphp-version` warning, documentSymbol merge, per-folder clients, esbuild bundle (`npm run build`)
- [x] `cphp_export_php`, `cphp()`, `--lib`, `libs.json`; two-project test (FetchContent and installed); `cphp_setup_vscode`

## TODO (current focus: finish Milestone 0 spike, then 1b)

- [ ] Resolve all **(verify)** items (see `remaining_tasks/REMAINING_TASKS.md`)

## Gotchas

- **Echo placeholder heuristic** (`cphp_shadow_is_operator`): binary-operator position -> `+`, otherwise `_` identifier. `return <?= $sym ?> b` (unary operator) is still a false C error in the live view.

- **`editor/vscode/server/` is generated** by `npm run stage` (copies proxy + `bin/cphp-shadow.php`); never edit it. Without it the extension falls back to the repo layout (`../lsp-proxy`, `../../bin`), which is how F5 development works.
- The client launches the proxy with `process.execPath` + `ELECTRON_RUN_AS_NODE=1` (no system Node needed); `php` and `clangd` must be on PATH or set in settings.

- **libs.json is read once at proxy start** (for PHP server workspace folders); run `cphp.restart` after relinking libs.
- **Generated header include dir is the whole `cphp/` output root** (PRIVATE until `cphp_export_headers`), so `.c` outputs there are includable too; `cphp_export_headers` must come after `cphp_add_sources`, which must come after `cphp_export_php`/`cphp_use_composer`. A target using `cphp_add_sources` needs its own `composer.lock` if it uses Composer (`tests/two-project/producer/composer.lock`).
- **PHP server is opt-in**: no default binary; Intelephense is licensed separately. Region routing is by shadow characters, so a cursor in whitespace inside a PHP block routes to clangd unless the previous character is PHP. Position requests are routed and document symbols merged; semantic tokens (`semanticTokens/full`) are merged from both servers under a merged legend (range and delta are not advertised; stub-tested only, see `remaining_tasks/archive/2026-10-26-semantic-tokens.md`); code actions come from clangd only. `proxy-php-test.js` is not in ctest.
- **Semantic tokens are always filtered by the proxy**: clangd tokens whose shadow text differs from the template (echo placeholders `+`/`_`) are dropped, otherwise a `<` before `<?=` got an operator colour. So the proxy always advertises full-only tokens (no delta/range), with or without a PHP server. Found in the first real VS Code run; covered by `proxy-test.js`.
- **Hover on echo-built names** (`op_<?= $name ?>`): the proxy rewrites the placeholder word in clangd's hover text to the template spelling. It does not show the expanded value (`op_add`); that would need the expander's output per loop iteration. Other features (completion, symbols, diagnostics) still show the `_` placeholder name.
- **Locations in generated files map back to the template** via `foo.c.map` (proxy `remapLocations`): definition/references from `main.c` or a header land on `foo.c.php`. Lines use the map's [generated, template] pairs; columns match up to the first divergence (an expanded `<?= ?>` start), range ends inside an expansion go to the end of the echo tag. Several expansions of one template line collapse to one result. Rename/workspace edits and `documentLink` are not remapped. Needs the `.map` file next to the generated file. The e2e test for it skips itself when clangd has not yet indexed the generated definition.
- **Golden files**: regenerate with `php -d short_open_tag=0 tests/run-golden.php --update` and review the diff; `.expected` files contain CRLF bytes for `crlf.c.php` (`.gitattributes` marks `tests/golden/*` as `-text`).
- **Extension is bundled**: `main` is `./out/extension.js`; run `npm run build` before F5 (`npm run package` does it). `extension.js`/`discovery.js` are not shipped, only the bundle.
- **Proxy sync is serial and blocking**: each didOpen/didChange spawns `php cphp-shadow.php` synchronously (tens of ms). Move to a long-lived PHP worker if typing latency matters. The e2e test (`editor/lsp-proxy/test/proxy-test.js`) is not in ctest.

- **Matchers are `$cphp-*`**, not `$gcc`/`$msCompile` (built-ins can't be redefined). Grammar tests need VS Code's built-in grammars installed or `CPHP_VSCODE_EXTENSIONS`; they skip otherwise.

- **Composer lock workflow**: first run `-DCPHP_COMPOSER_UPDATE=ON` (cached; turn it off again), commit `composer.lock`. Any participant `composer.json` change (even whitespace) makes it stale. The target calling `cphp_add_sources` must itself call `cphp_use_composer`.
- **Composer participants are staged copies**: `*.php`, `composer.json` and the files named by its `autoload` (`files`, `classmap`, `psr-4`, `psr-0` paths, any extension, e.g. `.inc`) are copied; editing them re-runs configure and reinstalls. Participant dirs are globbed recursively (excluding `vendor/`, `.git/`, build tree): keep them small.

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
- **Shadows preserve per-line UTF-16 width and newline bytes** (byte length may differ for non-ASCII); any width change breaks identity position mapping.
- **clang-format is unsafe on the C shadow.**
- **compile_commands.json**: `cphp_add_sources` sets the target property `EXPORT_COMPILE_COMMANDS` (the variable does not propagate from subprojects); the user's other targets are untouched.
- **npm project is `editor/vscode/` only**: `node_modules/`, lockfile and `.vsix` stay there; no root `package.json`.
- **Security**: expanding a template runs arbitrary PHP; gate editor-triggered runs behind Workspace Trust.
- License is MIT (`LICENSE`); the copyright holder line is "Richie Kho" — adjust if needed.
- **Go-to-definition on echo-built names** (`op_<?= $n ?>`): the name does not exist in the template, so the proxy answers itself with the generated names (`op_add`, `op_sub`, ... in `build/cphp/<name>.c`, via `.map`). VS Code peeks when there are several; set `editor.gotoLocation.multipleDefinitions` to `goto` to jump to the first. Plain `.c` files (e.g. `main.c`) are not served by the cphp client, so another clangd extension jumps to the generated C unremapped (open: widen `documentSelector`).
- **PHP features default to Intelephense** (`cphp.phpServer` = `intelephense`); if it is not on PATH the proxy shows a one-time warning and PHP regions get no features. If missing, the extension offers an npm install into its global storage (`offerIntelephense` in `extension.js`; run via `node intelephense.js`, verified headless only). PHP hover verified in real VS Code (2026-10-26, Intelephense); completion and PHP go-to-def not yet confirmed.
- **Multi-root: command-id collision** (found in real VS Code, fixed): each client registers clangd's `clangd.applyFix`/`applyTweak` globally, so the second folder's client failed with `command 'clangd.applyFix' already exists`. The proxy now drops `executeCommandProvider` (clangd tweak actions that need a command are lost; fix-its carry edits). Verified in real VS Code with two folders: both clients start, separate build dirs, squiggles stay in their own folder (2026-10-26).
- **Requests after `didClose`**: VS Code can still send documentSymbol/foldingRange/etc. for a template it just closed; clangd answered `non-added document` errors (noisy log). The proxy now replies `null` to any request for a template that is not open.
