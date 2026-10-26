#pragma once
<?php foreach (['x', 'y'] as $f): ?>
int get_<?= $f ?>(void);
<?php endforeach ?>
