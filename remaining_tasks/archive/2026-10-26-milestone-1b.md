# Completed 2026-10-26 (Milestone 1b)

- [x] `cphp_export_php()`, transitive lib collection, `--lib NAME=path`, `cphp()` resolver in the expander
- [x] `install(DIRECTORY)` of PHP dirs (`CPHP_INSTALL`, default on for top-level); two-project test (`tests/two-project`) works via FetchContent and via installed packages
- [x] **(verified, refuted)** custom `INTERFACE_CPHP_LIBS` via genex is impossible (`INTERFACE_*` reserved for export, genex forbidden in exported properties, not transitive). Replaced by the plain `CPHP_LIBS` property + `$<0:...>` entry in `INTERFACE_LINK_LIBRARIES` + own link-closure walk. Works for imported targets.
- [x] `cphp_setup_vscode([INSTALL])`: merges `.vscode/extensions.json`, opt-in install with version check, stamp file, CI/nested skip
- [x] Extension ID default `rechiekho.cphp`
- [x] Expander/module version check (`--version`) and `cphpVersion` in `libs.json`
