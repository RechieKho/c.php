# Milestone 2a: shadow generator (done 2026-10-26)

- [x] `bin/cphp-shadow.php <template> --lang c|php` (library function `cphp_shadow()`), installed with the expander
- [x] Invariants tested in `tests/shadow-test.php` (ctest `cphp_shadow` with `CPHP_BUILD_EXAMPLES=ON`): per-line UTF-16 width, newline bytes (LF/CRLF/CR), echo placeholders, unterminated PHP, bare `<?`
