# Milestone 2d: proxy reads libs.json (done 2026-10-26)

- `editor/lsp-proxy/cphp-lsp-proxy.js`: `textDocument/definition` on a `cphp('lib/file.php')` string literal in a `*.c.php`/`*.h.php` document is answered by the proxy with a Location at line 0 of the resolved file. Other positions go to clangd.
- `libs.json` files are found next to generated siblings from `compile_commands.json` (`<dir>/cphp/libs.json`) plus `<compile-commands-dir>/cphp/libs.json`; cached by mtime; first definition of a lib name wins.
- Resolution mirrors `cphp()` in `bin/cphp.php`: must exist and stay inside the lib dir.
- Covered by `editor/lsp-proxy/test/proxy-test.js` (fake lib dir + libs.json).
- Not done: adding lib dirs to PHP include paths (Milestone 3), `cphpVersion` comparison, vendor-dir entry.
