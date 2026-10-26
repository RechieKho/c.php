<?php
declare(strict_types=1);

/*
 * cphp expander: template.c.php -> template.c
 *
 * Usage: php -d short_open_tag=0 cphp.php <template> <output> [--depfile <file>] [--map <file>] [--lib NAME=path]... [--autoload <file>]
 *       php cphp.php --version
 *
 * The template is tokenized with PhpToken::tokenize and turned into a PHP
 * program with the same line layout as the template (so PHP errors report
 * template lines). Static text is emitted through cphp_emit(), which inserts
 * `#line` directives whenever the output drifts from the template and records
 * them in the source map. Paths written to #line, depfile and map always use
 * forward slashes.
 */

if (PHP_VERSION_ID < 80000) {
    fwrite(STDERR, "cphp: PHP >= 8.0 required, found " . PHP_VERSION . "\n");
    exit(2);
}
if (ini_get('short_open_tag')) {
    fwrite(STDERR, "cphp: run PHP with -d short_open_tag=0 (a stray `<?` in C would be parsed as PHP)\n");
    exit(2);
}

const CPHP_VERSION = '0.1.0';

final class CphpState
{
    /** @var array<string,string> registered PHP libraries, NAME => real directory */
    public static array $libs = [];
    public static string $autoload = '';
    public static string $template = '';
    public static string $out = '';
    public static bool $atLineStart = true;
    public static int $outLines = 0;   // newlines already in $out
    public static int $tplLine = 1;    // template line the next generated line is believed to map to
    /** @var list<array{int,int}> [generated line, template line] */
    public static array $map = [];
}

function cphp_path(string $p): string
{
    return str_replace('\\', '/', $p);
}

function cphp_count_newlines(string $s): int
{
    return preg_match_all('/\r\n|\r|\n/', $s);
}

function cphp_append(string $s): void
{
    if ($s === '') {
        return;
    }
    CphpState::$out .= $s;
    CphpState::$outLines += substr_count($s, "\n");
    CphpState::$atLineStart = str_ends_with($s, "\n");
}

/** Move output produced by echo / <?= ?> into the result. */
function cphp_flush_dynamic(): void
{
    $dyn = (string) ob_get_contents();
    if ($dyn === '') {
        return;
    }
    ob_clean();
    cphp_append($dyn);
    CphpState::$tplLine += cphp_count_newlines($dyn);
}

/** Called by the generated program for each run of literal text. */
function cphp_emit(string $text, int $line): void
{
    cphp_flush_dynamic();
    $n = cphp_count_newlines($text);
    $emitted = false;
    if (CphpState::$atLineStart && (CphpState::$tplLine !== $line || CphpState::$out === '')) {
        $file = addcslashes(CphpState::$template, "\\\"");
        cphp_append("#line $line \"$file\"\n");
        // The directive occupies one line; the next line is the mapped one.
        CphpState::$map[] = [CphpState::$outLines + 1, $line];
        $emitted = true;
    }
    cphp_append($text);
    CphpState::$tplLine = $emitted ? $line + $n : CphpState::$tplLine + $n;
}

/** Template tokens -> PHP program whose line N is template line N. */
function cphp_compile(string $source): string
{
    $program = '';
    foreach (PhpToken::tokenize($source) as $tok) {
        switch ($tok->id) {
            case T_INLINE_HTML:
                $program .= 'cphp_emit(base64_decode(\'' . base64_encode($tok->text) . '\'), ' . $tok->line . ');'
                    . str_repeat("\n", cphp_count_newlines($tok->text));
                break;
            case T_OPEN_TAG:
                // open tag plus whitespace; keep the whitespace (and its newlines).
                $program .= substr($tok->text, 5);
                break;
            case T_OPEN_TAG_WITH_ECHO:
                $program .= 'echo ' . substr($tok->text, 3);
                break;
            case T_CLOSE_TAG:
                // PHP swallows one newline after the close tag (CRLF as one unit); keep line count.
                $program .= ';' . str_repeat("\n", cphp_count_newlines($tok->text));
                break;
            case T_DIR:
                $program .= var_export(dirname(CphpState::$template), true);
                break;
            case T_FILE:
                $program .= var_export(CphpState::$template, true);
                break;
            default:
                $program .= $tok->text;
        }
    }
    return $program;
}

/**
 * Resolve 'lib/rel/file.php' against the registered --lib directories.
 * Templates use it as: require_once cphp('mylib/macros.php');
 */
function cphp(string $logical): string
{
    $parts = explode('/', str_replace('\\', '/', $logical), 2);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
        throw new InvalidArgumentException("cphp('$logical'): expected 'lib/path.php'");
    }
    [$name, $rel] = $parts;
    if (!isset(CphpState::$libs[$name])) {
        $known = CphpState::$libs ? implode(', ', array_keys(CphpState::$libs)) : 'none';
        throw new RuntimeException("cphp('$logical'): unknown library '$name' (registered: $known)");
    }
    $dir = CphpState::$libs[$name];
    $real = realpath("$dir/$rel");
    if ($real === false || !is_file($real)) {
        throw new RuntimeException("cphp('$logical'): file not found in library '$name' ($dir)");
    }
    $real = cphp_path($real);
    if (!str_starts_with($real, rtrim($dir, '/') . '/')) {
        throw new RuntimeException("cphp('$logical'): resolves outside library '$name'");
    }
    return $real;
}

function cphp_run(string $__cphp_program): void
{
    eval($__cphp_program);
}

function cphp_report(string $kind, string $file, int $line, string $msg): void
{
    if (str_contains($file, "eval()'d code")) {
        $file = CphpState::$template;
    }
    fwrite(STDERR, cphp_path($file) . ":$line: $kind: $msg\n");
}

function cphp_escape_dep(string $p): string
{
    return str_replace([' ', '#', '$'], ['\\ ', '\\#', '$$'], cphp_path($p));
}

function cphp_main(array $argv): int
{
    $args = array_slice($argv, 1);
    if ($args === ['--version']) {
        echo 'cphp ' . CPHP_VERSION . "\n";
        return 0;
    }
    $positional = [];
    $depfile = null;
    $mapfile = null;
    for ($i = 0; $i < count($args); $i++) {
        switch ($args[$i]) {
            case '--depfile':
                $depfile = $args[++$i] ?? null;
                break;
            case '--map':
                $mapfile = $args[++$i] ?? null;
                break;
            case '--autoload':
                $a = realpath($args[++$i] ?? '');
                if ($a === false) {
                    fwrite(STDERR, "cphp: --autoload file not found\n");
                    return 2;
                }
                CphpState::$autoload = cphp_path($a);
                break;
            case '--lib':
                $spec = $args[++$i] ?? '';
                $eq = strpos($spec, '=');
                $real = $eq ? realpath(substr($spec, $eq + 1)) : false;
                if ($real === false) {
                    fwrite(STDERR, "cphp: bad --lib '$spec' (expected NAME=existing-dir)\n");
                    return 2;
                }
                CphpState::$libs[substr($spec, 0, $eq)] = cphp_path($real);
                break;
            default:
                $positional[] = $args[$i];
        }
    }
    if (count($positional) !== 2 || ($depfile === null && in_array('--depfile', $args, true))
        || ($mapfile === null && in_array('--map', $args, true))) {
        fwrite(STDERR, "usage: cphp.php <template> <output> [--depfile <file>] [--map <file>]\n");
        return 2;
    }
    [$template, $output] = $positional;

    $source = @file_get_contents($template);
    if ($source === false) {
        fwrite(STDERR, "cphp: cannot read template $template\n");
        return 2;
    }
    $templateReal = realpath($template);
    CphpState::$template = cphp_path($templateReal !== false ? $templateReal : $template);

    set_error_handler(function (int $no, string $msg, string $file, int $line): bool {
        $deprecated = ($no & (E_DEPRECATED | E_USER_DEPRECATED)) !== 0;
        $kind = $deprecated ? 'note' : (($no & (E_NOTICE | E_USER_NOTICE | E_WARNING | E_USER_WARNING)) ? 'warning' : 'error');
        cphp_report($kind, $file, $line, $msg);
        return true;
    });

    ob_start();
    $status = 0;
    try {
        if (CphpState::$autoload !== '') {
            require_once CphpState::$autoload;
        }
        cphp_run(cphp_compile($source));
        cphp_flush_dynamic();
    } catch (Throwable $e) {
        $status = 1;
        cphp_report('error', $e->getFile(), $e->getLine(), get_class($e) . ': ' . $e->getMessage());
    }
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    restore_error_handler();

    if ($status !== 0) {
        @unlink($output);
        return $status;
    }

    $outDir = dirname($output);
    if (!is_dir($outDir) && !@mkdir($outDir, 0777, true) && !is_dir($outDir)) {
        fwrite(STDERR, "cphp: cannot create $outDir\n");
        return 2;
    }
    if (file_put_contents($output, CphpState::$out) === false) {
        fwrite(STDERR, "cphp: cannot write $output\n");
        return 2;
    }

    if ($mapfile !== null) {
        $rows = implode(",\n    ", array_map(fn($e) => json_encode($e), CphpState::$map));
        $json = "{\n  \"version\": 1,\n  \"template\": " . json_encode(CphpState::$template, JSON_UNESCAPED_SLASHES)
            . ",\n  \"generated\": " . json_encode(cphp_path($output), JSON_UNESCAPED_SLASHES)
            // Each entry: generated line N starts template line M (valid until the next entry).
            . ",\n  \"lines\": [\n    " . $rows . "\n  ]\n}";
        file_put_contents($mapfile, $json . "\n");
    }

    if ($depfile !== null) {
        $self = realpath(__FILE__);
        $deps = [CphpState::$template];
        // Composer vendor files are tracked through the lock/composer.json by CMake, not here.
        $vendor = CphpState::$autoload !== '' ? dirname(CphpState::$autoload) . '/' : null;
        foreach (get_included_files() as $f) {
            if ($f !== $self && ($vendor === null || !str_starts_with(cphp_path($f), $vendor))) {
                $deps[] = $f;
            }
        }
        $deps = array_values(array_unique(array_map('cphp_path', $deps)));
        file_put_contents($depfile, cphp_escape_dep($output) . ': '
            . implode(' ', array_map('cphp_escape_dep', $deps)) . "\n");
    }
    return 0;
}

exit(cphp_main($argv));
