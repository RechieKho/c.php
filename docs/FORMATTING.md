# Formatter policy

**Templates (`*.c.php`, `*.h.php`) are not auto-formatted.**

- Neither clang-format nor a PHP formatter understands the mix. clang-format on the C shadow
  would rewrite the blanked PHP regions and break the line/column identity the editor relies on;
  a PHP formatter would reflow the C text as inline HTML.
- The LSP proxy removes clangd's formatting capabilities, and the extension sets
  `editor.formatOnSave/Paste/Type` to `false` for the `cphp` language.
- Format by hand: keep PHP blocks short, put C declarations in generated headers or plain
  `.h` files (which clang-format can handle), and move non-trivial PHP logic into shared `.php`
  files (`cphp_export_php`, Composer packages) that a normal PHP formatter can format.
- The generated `<build>/cphp/*.c` files are build artifacts; do not format them.
