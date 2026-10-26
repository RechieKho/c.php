# cphp LSP proxy

`cphp-lsp-proxy.js`: stdio proxy between an editor and clangd for `*.c.php` / `*.h.php`. No npm dependencies (Node >= 16).

```
node cphp-lsp-proxy.js [--clangd PATH] [--php PATH] [--shadow PATH] --compile-commands-dir=<build> [clangd args]
```

- Templates are sent to clangd as their C shadow (`bin/cphp-shadow.php`) under the generated sibling URI, so clangd uses the real flags; URIs are translated both ways, positions pass through unchanged.
- Advertises full-text sync and hides formatting (unsafe on shadows). Templates with no entry in `compile_commands.json` fall back to a virtual `<name>.cphp-shadow.c` URI (inferred flags).
- With `--cphp-version V` it warns when a build's `libs.json` `cphpVersion` differs; with `--phpls` it merges diagnostics and document symbols from the PHP server.
- Using it from Neovim, Helix or Zed (untested): [docs/EDITORS.md](../../docs/EDITORS.md).
- Tests: `node test/proxy-test.js` (cmake, clangd, php), `node test/proxy-stub-test.js` (php only). Both run under ctest with `-DCPHP_BUILD_EXAMPLES=ON`.
