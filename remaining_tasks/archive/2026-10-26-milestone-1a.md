# Completed 2026-10-26 (Milestone 1a core)

- [x] Minimal `bin/cphp.php`: expand, emit `#line`, write depfile
- [x] `cphp_add_sources()` builds `tests/example-project` on a clean checkout (Ninja, macOS)
- [x] `.map` source map output; PHP errors mapped to template lines (`file:line: error: msg`)
- [x] `find_package(cphp)` support (`cmake/cphp-config.cmake`, install rules; tested from an install prefix)
- [x] Output scoped to `CMAKE_CURRENT_BINARY_DIR`
- [x] Root `CMakeLists.txt` early return if c.php already loaded
- [x] Clear error when PHP is missing
- [x] VS-generator warning (DEPFILE omitted there); forward-slash paths in `#line`/depfile/map; CRLF handled in expander
