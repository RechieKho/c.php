#pragma once
<?php $sizes = ['small' => 4, 'large' => 4 * 16]; ?>
<?php foreach ($sizes as $n => $v): ?>
#define PRODUCER_SIZE_<?= strtoupper($n) ?> <?= $v ?>

<?php endforeach ?>
int producer_total(void);
