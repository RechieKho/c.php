# Other editors (Neovim, Helix, Zed)

> **Untested.** These setups are written from each editor's documentation and the proxy's behaviour; none has been run in the real editor. Treat them as a starting point and report what breaks. VS Code is the supported client (`editor/vscode/`).

Any LSP client can use c.php through the proxy, [`editor/lsp-proxy/cphp-lsp-proxy.js`](../editor/lsp-proxy/README.md). It speaks plain LSP over stdio, starts clangd itself and forwards everything that is not a `*.c.php` / `*.h.php` document unchanged.

## What you need

- Node >= 16, `php` and `clangd` on `PATH`.
- A configured build with `compile_commands.json` (`cmake -S . -B build`; `cphp_add_sources` turns on `EXPORT_COMPILE_COMMANDS` for its targets). Without an entry the proxy falls back to inferred flags.
- The proxy run from a c.php checkout (it finds `bin/cphp-shadow.php` relative to itself), or `--shadow PATH`.
- The editor must treat `*.c.php` / `*.h.php` as a filetype that attaches the C language server. The proxy rewrites the document's `languageId` to `c` for clangd, so the id your editor sends does not matter.

Command line (all arguments after the proxy's own are passed to clangd):

```
node /path/to/c.php/editor/lsp-proxy/cphp-lsp-proxy.js --stdio \
  --compile-commands-dir=/abs/path/to/build
```

Optional: `--cphp-version V` (warn when `libs.json` was written by another c.php version), `--phpls intelephense --phpls-arg --stdio` (route PHP regions to a PHP language server; diagnostics, symbols and semantic tokens are merged).

Formatting is hidden by the proxy on purpose (see [FORMATTING.md](FORMATTING.md)); do not enable format-on-save for these files through another tool.

## Neovim

Needs Neovim >= 0.10 (`vim.fs.root`, `vim.lsp.start`). Put this in `init.lua`:

```lua
local cphp = '/path/to/c.php'   -- checkout containing editor/lsp-proxy

vim.filetype.add({ pattern = { ['.*%.[ch]%.php'] = 'cphp' } })

vim.api.nvim_create_autocmd('FileType', {
  pattern = 'cphp',
  callback = function(ev)
    local root = vim.fs.root(ev.buf, { 'build/compile_commands.json', 'CMakeLists.txt', '.git' })
    if not root then return end
    vim.lsp.start({
      name = 'cphp',
      cmd = { 'node', cphp .. '/editor/lsp-proxy/cphp-lsp-proxy.js', '--stdio',
              '--compile-commands-dir=' .. root .. '/build' },
      root_dir = root,
    })
  end,
})
```

Notes:
- Highlighting: filetype `cphp` has no tree-sitter parser; semantic tokens from the server still apply, and `vim.treesitter.language.register('c', 'cphp')` gives C highlighting for the C regions (the PHP blocks are then mis-highlighted).
- Plain `.c` / `.h` files keep using your normal clangd setup; the proxy is attached only to templates. If you also want the proxy there, change the `FileType` pattern.

## Helix

`~/.config/helix/languages.toml` (or `.helix/languages.toml` in the project):

```toml
[language-server.cphp]
command = "node"
args = ["/path/to/c.php/editor/lsp-proxy/cphp-lsp-proxy.js", "--stdio", "--compile-commands-dir=build"]

[[language]]
name = "cphp"
scope = "source.cphp"
file-types = [{ glob = "*.c.php" }, { glob = "*.h.php" }]
grammar = "c"
comment-token = "//"
language-servers = ["cphp"]
```

Notes:
- `--compile-commands-dir=build` is relative; Helix starts language servers in the workspace root, so run `hx` from the project root (or use an absolute path).
- `grammar = "c"` highlights the file as C; PHP blocks are not highlighted as PHP.

## Zed

Zed attaches servers by language, so map the templates to C and replace clangd's binary with the proxy (`settings.json`):

```json
{
  "file_types": { "C": ["*.c.php", "*.h.php"] },
  "lsp": {
    "clangd": {
      "binary": {
        "path": "node",
        "arguments": [
          "/path/to/c.php/editor/lsp-proxy/cphp-lsp-proxy.js",
          "--stdio",
          "--compile-commands-dir=/abs/path/to/build"
        ]
      }
    }
  }
}
```

Notes:
- This puts the proxy in front of every C file in Zed, not just templates; it forwards non-template documents untouched. Scope it to one project with `.zed/settings.json`.
- The path to the build directory must be absolute or relative to Zed's working directory for the server, which is the worktree root in current versions; use an absolute path to be safe.
- Zed may pass its own clangd arguments when it manages the binary; with `binary.path` set it uses only the arguments given here.

## Troubleshooting

- No diagnostics or wrong flags: run the proxy by hand (`echo | node cphp-lsp-proxy.js --stdio ...`); errors go to stderr as `[cphp-proxy] ...`. Make sure `build/compile_commands.json` lists the generated `build/.../cphp/<name>.c`.
- `cannot start clangd`: pass `--clangd /path/to/clangd`.
- `php` not found: pass `--php /path/to/php`.
- Stale libs after relinking PHP libraries: restart the language server (`libs.json` is read once at start).
