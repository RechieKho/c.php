<?php require_once cphp('producer/macros.php'); ?>
int get_double(void);
<?= getter('double', 'int', '84') ?>
const char *greeting = "<?= \Producer\Greeter::word() ?>";
const char *legacy = "<?= \Producer\Legacy::tag() . producer_suffix() ?>";
