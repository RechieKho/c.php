# Milestone 2b: C-side LSP proxy (done 2026-10-26)

- [x] `editor/lsp-proxy/cphp-lsp-proxy.js`: framing, shadow substitution, sibling-URI mapping via `compile_commands.json` (first `#line` of the generated file breaks ties), deep URI translation both ways, full-sync + no-formatting capability patch
- [x] `editor/lsp-proxy/test/proxy-test.js`: real clangd on the example project (diagnostics on template URI/line, hover, definition, didChange)
