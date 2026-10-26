static const int table[] = {
<?php
for ($i = 0; $i < 3; $i++) {
    echo "    ", $i * $i, ",\n";
}
?>
};
int n = <?= count([1,
  2]) ?>;
