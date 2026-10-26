# c.php VS Code extension

Contributes the `cphp` language (`*.c.php`, `*.h.php`), a TextMate grammar and problem matchers. The LSP client for `editor/lsp-proxy` is not implemented yet (Milestone 2).

- **Grammar** (`syntaxes/cphp.tmLanguage.json`): `source.c` outside, `source.php` inside `<?php ... ?>` / `<?= ... ?>`. Bare `<?` is C (the expander runs with `short_open_tag=0`).
- **Problem matchers**: `$cphp-gcc`, `$cphp-msvc` (errors carry the template path via `#line`), `$cphp-php` (expander/PHP errors).
- **Tests**: `npm install && npm test` from this directory. Grammar tests use VS Code's built-in C/PHP grammars (`CPHP_VSCODE_EXTENSIONS` overrides the location) and are skipped if absent.

- **PHP features** (hover, completion, go-to-definition inside `<?php` regions): `cphp.phpServer` defaults to `intelephense`. If it is not on PATH the extension offers to install it with npm into its own storage (no global install; Intelephense is third-party, free tier). "Don't ask again" is remembered; set `cphp.phpServer` to another server (e.g. `phpactor` with `cphp.phpServerArgs` `["language-server"]`) or to an empty string to disable.

- **Plain C files** (`cphp.serveCFiles`, default on): `main.c` etc. in a folder with templates go through the same proxy, so go-to-definition into generated code lands on the `.c.php` template. Run only one C/C++ language service per workspace: the extension offers to set `C_Cpp.intelliSenseEngine` to `disabled` for the workspace if C/C++ (`ms-vscode.cpptools`) is installed. The prompt shows once; run **c.php: Disable C/C++ IntelliSense for this workspace** later.

See `../../architecture/ARCHITECTURE_SPEC.md`.
