# Debugging and error locations

The expander writes `#line N "<template>"` directives into the generated C, so compiler
diagnostics and debug info point at the **template** (`foo.c.php`), not at
`<build>/cphp/foo.c`.

## Debuggers

Verified with lldb on macOS (`-g`): `breakpoint set -f table.c.php -l 5` stops at
`table.c.php:5` and the backtrace names `table.c.php`. gdb, cpptools and CodeLLDB read
the same DWARF line table, so breakpoints in templates work the same way.

- Build with debug info (`-DCMAKE_BUILD_TYPE=Debug` or `-g`).
- The `#line` path is the template's absolute, forward-slash path. If a debugger cannot
  match it (moved checkout, remote or container debugging), map it with the debugger's
  source-path substitution, e.g. lldb `settings set target.source-map <old> <new>`, gdb
  `set substitute-path <old> <new>`, cpptools `sourceFileMap`.
- The extension contributes `breakpoints` for the `cphp` language, so VS Code lets you set
  breakpoints in `*.c.php` / `*.h.php` without `debug.allowBreakpointsEverywhere`.

## Limits

- A line inside a PHP loop expands to several C lines, so one template line can map to many
  code locations (one breakpoint, several hits/locations). That is expected.
- Output between `?>` and the next static chunk can drift by a line until the next `#line`
  (see STATE gotchas). The map `<build>/cphp/foo.c.map` lists generated-line to template-line pairs.
- PHP errors in a template are printed as `template:line: error: ...` at build time; the
  `$cphp-php` problem matcher picks them up. PHP code is not debugged by this tool (it runs
  before compilation); use `var_dump`/`error_log` or run `php bin/cphp.php` directly under Xdebug.
