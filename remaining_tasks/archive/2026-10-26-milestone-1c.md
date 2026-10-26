# Completed 2026-10-26 (Milestone 1c)

- [x] `cphp_use_composer()`, participants collected over the link closure (in-tree via `CPHP_COMPOSER`, installed via `$<0:cphpc:NAME=path>`), merged-root generator, locked install into the build dir, `--autoload` in the expander
- [x] Composer tests (manual, scratch projects + `tests/two-project`): package used by a template; two libs with compatible constraints solved; incompatible constraints give Composer's conflict chain at configure; missing lock; stale lock; installed (find_package) participant
- [x] **(verified)** path repos + `@dev` + `minimum-stability: dev` resolve alongside stable packages (psr/log)
- [x] **(refuted, redesigned)** absolute-path repos break lock portability (content-hash covers `repositories`), and Composer's hash does not cover participants' `composer.json`. Fix: stage participants under the root and use relative URLs; put a participant fingerprint in `extra`. Verified: a copied source tree and an installed-library build both accept the same committed lock.
- [x] **(moot)** vendor-dir redirect: the root lives in the build tree, so the default `<root>/vendor` is already there
