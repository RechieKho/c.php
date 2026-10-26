<?php $n = 3; ?>
int a = <?= $n ?>;
<?php if ($n > 1) { ?>
int b;
<?php } ?>

int c;<?php $x = 1; ?> int d = <?= $x ?>; <?php // line comment ?>
int e;
<?php
$items = ['p', 'q'];
foreach ($items as $i) {
    echo "int v_$i;\n";
}
?>
int f;
