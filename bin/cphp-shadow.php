<?php
declare(strict_types=1);

/*
 * cphp shadow generator: template.c.php -> same-layout virtual document.
 *
 * Usage: php -d short_open_tag=0 cphp-shadow.php <template> --lang c|php
 *
 * c   : PHP blocks become spaces (newlines kept); `<?= expr ?>` becomes a
 *       same-width placeholder identifier (`_` run) so C stays parseable.
 * php : C text becomes spaces (newlines kept); PHP blocks are kept verbatim.
 *
 * Every line has the same UTF-16 width as in the template and newline bytes
 * (\n, \r\n, \r) are preserved, so LSP positions map by identity.
 * Uses PhpToken::tokenize, like the expander (one tokenizer).
 */

if (PHP_VERSION_ID < 80000) {
    fwrite(STDERR, "cphp-shadow: PHP >= 8.0 required\n");
    exit(2);
}

/** Replace every non-newline character by spaces (one per UTF-16 unit). */
function cphp_shadow_blank(string $text, string $fill = ' '): string
{
    return preg_replace_callback('/[^\r\n]+/u', static function (array $m) use ($fill): string {
        $units = strlen(mb_convert_encoding($m[0], 'UTF-16LE', 'UTF-8')) / 2;
        return str_repeat($fill, (int) $units);
    }, $text) ?? preg_replace('/[^\r\n]/', ' ', $text);
}

/**
 * Echo placeholder: `_` while still on the line of the `<?=` tag, spaces after the
 * first newline, so the identifier never spans lines. $first carries across tokens.
 */
function cphp_shadow_placeholder(string $text, bool &$first): string
{
    $res = '';
    foreach (preg_split('/(\r\n|\r|\n)/', $text, -1, PREG_SPLIT_DELIM_CAPTURE) as $i => $part) {
        if ($i % 2 === 1) {
            $first = false;
            $res .= $part;
        } else {
            $units = (int) (strlen(mb_convert_encoding($part, 'UTF-16LE', 'UTF-8')) / 2);
            $res .= str_repeat($first ? '_' : ' ', $units);
        }
    }
    return $res;
}

function cphp_shadow(string $source, string $lang): string
{
    if ($lang !== 'c' && $lang !== 'php') {
        throw new InvalidArgumentException("lang must be 'c' or 'php'");
    }
    $out = '';
    $echo = false;   // inside a <?= block
    $first = true;   // still on the first line of that block
    foreach (PhpToken::tokenize($source) as $tok) {
        $text = $tok->text;
        switch ($tok->id) {
            case T_INLINE_HTML:
                $out .= $lang === 'c' ? $text : cphp_shadow_blank($text);
                break;
            case T_OPEN_TAG:
                $echo = false;
                $out .= $lang === 'php' ? $text : cphp_shadow_blank($text);
                break;
            case T_OPEN_TAG_WITH_ECHO:
                $echo = true;
                $first = true;
                $out .= $lang === 'php' ? $text : cphp_shadow_placeholder($text, $first);
                break;
            case T_CLOSE_TAG:
                /* The newline PHP swallows after the close tag stays in the shadow as a newline. */
                if ($lang === 'php') {
                    $out .= $text;
                } else {
                    $out .= $echo ? cphp_shadow_placeholder($text, $first) : cphp_shadow_blank($text);
                }
                $echo = false;
                break;
            default:
                if ($lang === 'php') {
                    $out .= $text;
                } else {
                    $out .= $echo ? cphp_shadow_placeholder($text, $first) : cphp_shadow_blank($text);
                }
        }
    }
    return $out;
}

if (isset($argv[0]) && realpath($argv[0]) === __FILE__) {
    if (ini_get('short_open_tag')) {
        fwrite(STDERR, "cphp-shadow: run PHP with -d short_open_tag=0\n");
        exit(2);
    }
    $file = $argv[1] ?? null;
    $lang = ($argv[2] ?? '') === '--lang' ? ($argv[3] ?? '') : '';
    if ($file === null || !in_array($lang, ['c', 'php'], true)) {
        fwrite(STDERR, "usage: cphp-shadow.php <template> --lang c|php\n");
        exit(2);
    }
    $src = @file_get_contents($file);
    if ($src === false) {
        fwrite(STDERR, "cphp-shadow: cannot read $file\n");
        exit(1);
    }
    fwrite(STDOUT, cphp_shadow($src, $lang));
}
