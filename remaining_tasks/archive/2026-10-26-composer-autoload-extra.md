# Composer: stage non-PHP autoload files (done 2026-10-26)

- `cmake/CPhp.cmake`: `_cphp_composer_autoload_extra` reads a participant's `composer.json` (`string(JSON)`, CMake >= 3.19) and adds the files named by `autoload.files`, plus everything under `classmap` / `psr-4` / `psr-0` paths, to `_cphp_composer_files`.
- Test: `tests/two-project/producer` gained `legacy/Legacy.inc` (classmap) and `legacy/helpers.inc` (files); `consumer/gen.c.php` and `main.c` use both. Without the change `composer install` fails (verified); both locks regenerated with `-DCPHP_COMPOSER_UPDATE=ON`.
- Not handled: `exclude-from-classmap`, `autoload-dev` (dev autoload is not used by the merged root).
