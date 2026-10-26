# Golden cases from STATE gotchas (done 2026-10-26)

- `tests/golden/close-tag-newlines.c.php`: newline swallowed after `?>` (block, inline and `//`-comment forms), multi-line `echo` in a PHP block. Its `.expected` deliberately pins the known drift: `int e;` joins `int c; int d = 1;` on one output line and the map only re-syncs at the next `#line` (STATE gotcha "`#line` is only emitted at a line start"). If the expander learns to emit `#line` mid-line or keep that newline, regenerate with `--update` and review.
- `tests/golden/magic-constants.c.php`: `__FILE__`, `__DIR__` (normalised to `@DIR@`-relative basename) and `__LINE__` rewriting.
- No named bug fixes exist in git history yet, so these came from the gotcha list instead.
