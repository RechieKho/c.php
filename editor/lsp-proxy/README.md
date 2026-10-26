# cphp LSP proxy

`cphp-lsp-proxy.js`: stdio proxy between an editor and clangd for `*.c.php` / `*.h.php`. No npm dependencies (Node >= 16).

```
node cphp-lsp-proxy.js [--clangd PATH] [--php PATH] [--shadow PATH] --compile-commands-dir=<build> [clangd args]
```

- Templates are sent to clangd as their C shadow (`bin/cphp-shadow.php`) under the generated sibling URI, so clangd uses the real flags; URIs are translated both ways, positions pass through unchanged.
- Advertises full-text sync and hides formatting (unsafe on shadows). Templates with no entry in `compile_commands.json` fall back to a virtual `<name>.cphp-shadow.c` URI (inferred flags).
- Test: `node test/proxy-test.js` (needs cmake, clangd, php).
