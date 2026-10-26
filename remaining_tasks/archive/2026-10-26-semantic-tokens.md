# Semantic tokens merge (done 2026-10-26)

- `editor/lsp-proxy/cphp-lsp-proxy.js`: `mergeLegends`, `decodeTokens`, `encodeTokens`, `replyTokens`; `semanticTokens/full` goes to both servers and the replies are merged (5 s timeout falls back to clangd's).
- Capability advertised: merged legend, `full: true`, `range: false` (no delta/range, so clients always ask for full).
- Test: `editor/lsp-proxy/test/proxy-stub-test.js` with role-specific legends in `stub-server.js`.
- Still unverified: real Intelephense/Phpactor token output and VS Code rendering.
