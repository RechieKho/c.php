# c.php VS Code extension

Contributes the `cphp` language (`*.c.php`, `*.h.php`), a TextMate grammar and problem matchers. The LSP client for `editor/lsp-proxy` is not implemented yet (Milestone 2).

- **Grammar** (`syntaxes/cphp.tmLanguage.json`): `source.c` outside, `source.php` inside `<?php ... ?>` / `<?= ... ?>`. Bare `<?` is C (the expander runs with `short_open_tag=0`).
- **Problem matchers**: `$cphp-gcc`, `$cphp-msvc` (errors carry the template path via `#line`), `$cphp-php` (expander/PHP errors).
- **Tests**: `npm install && npm test` from this directory. Grammar tests use VS Code's built-in C/PHP grammars (`CPHP_VSCODE_EXTENSIONS` overrides the location) and are skipped if absent.

See `../../architecture/ARCHITECTURE_SPEC.md`.
