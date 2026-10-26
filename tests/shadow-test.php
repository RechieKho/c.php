<?php
declare(strict_types=1);
// Shadow invariants: same line count, same per-line UTF-16 width, same newline bytes.
// Run: php -d short_open_tag=0 tests/shadow-test.php

require __DIR__ . '/../bin/cphp-shadow.php';

function lines16(string $s): array
{
    return array_map(
        static fn(string $l): int => strlen(mb_convert_encoding($l, 'UTF-16LE', 'UTF-8')) / 2,
        preg_split('/\r\n|\r|\n/', $s)
    );
}
function newlines(string $s): string
{
    preg_match_all('/\r\n|\r|\n/', $s, $m);
    return implode('', $m[0]);
}

$fails = 0;
function expect(bool $ok, string $name): void
{
    global $fails;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
    $fails += $ok ? 0 : 1;
}

$cases = [
    'example' => (string) file_get_contents(__DIR__ . '/example-project/table.c.php'),
    'crlf' => "int a;\r\n<?php if (1): ?>\r\nint b;\r\n<?php endif ?>\r\nint c = <?= 1 +\r\n 2 ?>;\r\n",
    'cr only' => "a\r<?php x(); ?>\rb",
    'unicode' => "// héllo 😀\n<?php \$s = 'ü😀'; ?> int x = <?= '😀' ?>;\n",
    'no trailing newline' => "int x; <?php echo 1; ?>",
    'unterminated php' => "int x;\n<?php foo();\n",
    'bare short tag' => "int a = b <? c;\n",
    'comment with close tag' => "<?php // note ?> int x;\n",
    'empty' => '',
];

foreach ($cases as $name => $src) {
    $c = cphp_shadow($src, 'c');
    $p = cphp_shadow($src, 'php');
    expect(lines16($c) === lines16($src), "$name: C shadow line widths");
    expect(lines16($p) === lines16($src), "$name: PHP shadow line widths");
    expect(newlines($c) === newlines($src) && newlines($p) === newlines($src), "$name: newline bytes");
}

$c = cphp_shadow("a<?= \$x ?>b\nint <?= \$n ?>_f();", 'c');
expect(preg_match('/^a_+b\nint _+_f\(\);$/', $c) === 1, 'echo becomes identifier');
$c = cphp_shadow("x <?= foo(\n  1) ?> y", 'c');
expect(preg_match('/^x _+\s+ y$/', $c) === 1 && !preg_match('/_.*\n.*_/s', $c), 'multi-line echo: identifier on first line only');
$c = cphp_shadow("a <?php if (1): ?>\nint b;\n<?php endif ?>\n", 'c');
expect(trim($c) === "a\nint b;" || preg_match('/^a\s*\nint b;\n\s*\n$/', $c) === 1, 'statement blocks vanish');
$p = cphp_shadow("int a;\n<?php \$k = 1; ?>\n", 'php');
expect(str_contains($p, '<?php $k = 1; ?>') && !str_contains($p, 'int'), 'PHP shadow keeps PHP, blanks C');
$c = cphp_shadow("a <? b", 'c');
expect($c === "a <? b", 'bare <? left as C');

exit($fails ? 1 : 0);
