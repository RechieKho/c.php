# CI on Windows (2026-10-26)

First green run on all three OSes (run after commit `4dbc68b`).

- Windows failed `cphp_proxy` at first: `proxy-test.js` ran `cmake` with the default generator, which on Windows is Visual Studio and exports no `compile_commands.json`. The proxy then fell back to virtual siblings and found no `libs.json` directory, so the echo-name definition and `cphp('lib/...')` checks failed. Fix: configure with `-G Ninja` when `ninja` is available.
- Gotcha: any test that needs `compile_commands.json` must use a Makefile or Ninja generator.
- Not isolated by a test: CRLF bytes around `?>`, depfile drive-letter escaping, `clang-cl` flags.
