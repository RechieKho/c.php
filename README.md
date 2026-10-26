# c.php

> C's preprocessor is bare-minimum. Use PHP instead.

Write C with embedded PHP in `*.c.php` files. A CMake step expands them before the compiler runs, and a VS Code extension gives you completion, diagnostics and navigation for both languages in the same file.

> **Status: pre-alpha.** The CMake scaffolding exists; the expander and editor tooling do not yet. See [`remaining_tasks/`](remaining_tasks/REMAINING_TASKS.md).

## Usage

```cmake
include(FetchContent)
FetchContent_Declare(cphp
  GIT_REPOSITORY https://github.com/RechieKho/cphp
  GIT_TAG        v0.1.0)
FetchContent_MakeAvailable(cphp)

add_executable(app main.c)
cphp_add_sources(app table.c.php)
```

`table.c.php`:

```c
#include "table.h"

<?php $ops = ['add' => '+', 'sub' => '-', 'mul' => '*']; ?>
<?php foreach ($ops as $name => $sym): ?>
int op_<?= $name ?>(int a, int b) { return a <?= $sym ?> b; }
<?php endforeach ?>
```

Compiler errors and debugger steps point at `table.c.php`, not the generated file.

**Requirements:** CMake >= 3.20, PHP >= 8.0 CLI, a C compiler. Editor tooling also needs clangd and a PHP language server (Intelephense or Phpactor).

## Editor support

The VS Code extension lives in [`editor/vscode/`](editor/vscode/). Install from a release `.vsix` via **Extensions: Install from VSIX...** (only from sources you trust).

## Gotchas

- Names built by PHP (`<?= $name ?>_init()`) show as placeholders in the live editor view; real diagnostics arrive after a build.
- Keep C braces balanced within each PHP branch.
- Expanding a template runs arbitrary PHP. Only build code you trust.

## Docs

- [Architecture spec](architecture/ARCHITECTURE_SPEC.md)
- [Current state, TODOs and gotchas](state/STATE.md)
- [Remaining tasks](remaining_tasks/REMAINING_TASKS.md)

## Development

```sh
cmake -S . -B build -DCPHP_BUILD_EXAMPLES=ON
cmake --build build
```

## License

[MIT](LICENSE)
