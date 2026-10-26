# Milestone 3a: PHP side in the proxy (2026-10-26)

Done: `--phpls PATH [--phpls-arg ARG]...` on `editor/lsp-proxy/cphp-lsp-proxy.js`; VS Code settings `cphp.phpServer` / `cphp.phpServerArgs` (default `--stdio`, server off when empty).

- The proxy spawns the PHP server beside clangd and feeds it the PHP shadow (`--lang php`) under the **template's own URI** (`languageId: php`). Intelephense accepts `*.c.php`.
- Position requests (hover, completion, definition, declaration, typeDefinition, implementation, references, signatureHelp, documentHighlight, rename, prepareRename) are routed by region: the character at the position decides (non-blank in the PHP shadow = PHP, non-blank in the C shadow = C), else the one before it, else C. Everything else goes to clangd only.
- Diagnostics from both servers are merged per template URI and republished together.
- `initialize` goes to both; the client's reply is held until the PHP server answers (15 s timeout, then PHP is disabled) and completion/signature trigger characters and missing providers are merged into clangd's capabilities.
- PHP-server-originated requests get an id prefixed `php:` so client replies can be routed back. Notifications other than `textDocument/*` go to both servers.
- Test: `editor/lsp-proxy/test/proxy-php-test.js` (real clangd + Intelephense 1.x installed with `npm i intelephense`; set `CPHP_TEST_PHPLS`; skips if missing). Not in ctest.

## 3b: libs/vendor dirs for the PHP server

`libs.json` gained `"vendors": [...]` (written from `CPHP_VENDOR_DIRS`, set in `cphp_add_sources` when Composer participants exist). At `initialize` the proxy appends lib dirs and vendor dirs to the PHP server's `workspaceFolders`. Test: definition of a function in a `libs.json` lib dir via Intelephense.
