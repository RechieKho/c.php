#include "table.h"

<?php $ops = ['add' => '+', 'sub' => '-', 'mul' => '*']; ?>
<?php foreach ($ops as $name => $sym): ?>
int op_<?= $name ?>(int a, int b) { return a <?= $sym ?> b; }
<?php endforeach ?>
