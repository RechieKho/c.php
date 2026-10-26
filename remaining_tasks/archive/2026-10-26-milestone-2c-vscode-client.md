# Milestone 2c: VS Code client and packaging (done 2026-10-26)

- [x] `editor/vscode/extension.js`: starts `cphp-lsp-proxy.js` via vscode-languageclient on first `cphp` document; `c.php: Restart language server`; settings `cphp.buildDirectory|clangdPath|phpPath|clangdArgs`; untrusted workspaces unsupported
- [x] `editor/vscode/discovery.js`: build dir = `cphp.buildDirectory` (exclusive) > `cmake.buildDirectory` (variables as globs) > root/`build*`/`out/build/*` (freshest); unit-tested in `test/discovery-test.js`
- [x] `npm run package` stages proxy + shadow into `server/` (gitignored) and builds `cphp-0.1.0.vsix` (~580 KB)
