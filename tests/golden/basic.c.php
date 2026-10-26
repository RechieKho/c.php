#include <stdio.h>
<?php $names = ['a', 'b']; ?>
<?php foreach ($names as $n): ?>
int get_<?= $n ?>(void) { return <?= ord($n) ?>; }
<?php endforeach; ?>
