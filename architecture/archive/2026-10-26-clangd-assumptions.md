# Verified clangd assumptions (2026-10-26, Apple clangd 21, macOS, Ninja, CMake 4.4)

Spike: stdio client driving clangd with `--compile-commands-dir`, example project template `table.c.php`.

- `didOpen`/`didChange` work for a URI whose content is not on disk (virtual `table.cphp-shadow.c`), and for a compile-DB path (the generated sibling) whose text differs from disk.
- Flags: a URI that is in the compile DB (the generated sibling `<build>/cphp/table.c`) gets its exact flags. A URI not in the DB (the template `.c.php` or a virtual file) gets heuristically inferred flags from neighbours; diagnostics and hover worked, but with extra noise (e.g. "Included header is not used directly"). Decision: the proxy opens the C shadow under the sibling URI and maps URIs both ways.
- `#line` is ignored for LSP positions: diagnostics land on physical lines of the buffer.
- `CMAKE_EXPORT_COMPILE_COMMANDS` set inside a subproject only exports targets created in that directory scope, and does not cover the user's targets. The target property `EXPORT_COMPILE_COMMANDS` does work from a subproject. `cphp_add_sources` now sets it on the target unless the user chose a value.
- Hover/diagnostics on placeholders show the placeholder name (`op_____________`), as designed.
