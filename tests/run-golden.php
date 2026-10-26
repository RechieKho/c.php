<?php
declare(strict_types=1);
// Golden corpus: for every tests/golden/*.{c,h}.php run the expander and both shadows and
// compare with the committed `<name>.expected` (generated C), `<name>.shadow-c`, `<name>.shadow-php`.
// Run: php tests/run-golden.php [--update]
// Absolute template paths in #line are normalised to @DIR@. Bytes are compared as-is (CRLF included).

$dir = str_replace('\\', '/', __DIR__) . '/golden';
$bin = dirname(__DIR__) . '/bin';
$update = in_array('--update', $argv, true);
$tmp = sys_get_temp_dir() . '/cphp-golden-' . getmypid();
mkdir($tmp);

function run(array $cmd): array
{
    $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return [proc_close($p), $out, $err];
}

$fails = 0;
$check = static function (string $label, string $file, string $actual) use ($update, &$fails): void {
    if ($update) {
        file_put_contents($file, $actual);
        echo "wrote $file\n";
        return;
    }
    $ok = is_file($file) && file_get_contents($file) === $actual;
    echo ($ok ? 'ok   ' : 'FAIL ') . $label . "\n";
    $fails += $ok ? 0 : 1;
};

$templates = glob($dir . '/*.[ch].php') ?: [];
sort($templates);
foreach ($templates as $tpl) {
    $tpl = str_replace('\\', '/', $tpl);
    $name = basename($tpl);
    $out = "$tmp/$name.out";
    [$rc, , $err] = run([PHP_BINARY, '-d', 'short_open_tag=0', "$bin/cphp.php", $tpl, $out]);
    if ($rc !== 0) {
        echo "FAIL $name: expander exit $rc: " . trim($err) . "\n";
        $fails++;
        continue;
    }
    $check("$name: expansion", "$dir/$name.expected", str_replace($dir, '@DIR@', (string) file_get_contents($out)));
    foreach (['c', 'php'] as $lang) {
        [$rc, $sh, $err] = run([PHP_BINARY, '-d', 'short_open_tag=0', "$bin/cphp-shadow.php", $tpl, '--lang', $lang]);
        if ($rc !== 0) {
            echo "FAIL $name: shadow $lang exit $rc: " . trim($err) . "\n";
            $fails++;
            continue;
        }
        $check("$name: $lang shadow", "$dir/$name.shadow-$lang", $sh);
    }
    @unlink($out);
}
@rmdir($tmp);
echo $templates ? '' : "FAIL no templates in $dir\n";
exit($fails || !$templates ? 1 : 0);
