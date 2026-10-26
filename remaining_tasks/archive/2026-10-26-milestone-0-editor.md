# Milestone 0 editor items (done 2026-10-26)

- [x] TextMate grammar for `*.c.php` (`editor/vscode/syntaxes/cphp.tmLanguage.json`), tested with vscode-textmate against VS Code's built-in C and PHP grammars
- [x] Problem matchers `cphp-gcc`, `cphp-msvc`, `cphp-php` (named `cphp-*` because `$gcc`/`$msCompile` are VS Code built-ins and cannot be redefined; `autoDetect` file location)
