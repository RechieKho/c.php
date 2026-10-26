# Milestone 3b: headers, docs, release (2026-10-26)

- `foo.h.php` via `cphp_add_sources` -> `<build>/cphp/foo.h`; `cphp/` root added PRIVATE to the target. `cphp_export_headers(<target> [DESTINATION dir])` -> PUBLIC `BUILD_INTERFACE` / `INSTALL_INTERFACE`, `install(FILES ...)` per header (subdirs preserved). Verified: two-project FetchContent flow and installed flow (`gen/limits.h`).
- `docs/DEBUGGING.md` (lldb breakpoint in template verified), `docs/FORMATTING.md`; extension: `breakpoints` for `cphp`, `[cphp]` format-on-save/paste/type off (checked in `npm test`).
- `.github/workflows/release.yml`: on `v*` tags runs `npm test`, checks tag == package version, packages the `.vsix`, attaches it to a GitHub release, publishes to Marketplace / Open VSX when `VSCE_PAT` / `OVSX_PAT` secrets exist. Not yet run.
