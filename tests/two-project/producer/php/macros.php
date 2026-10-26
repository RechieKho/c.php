<?php
function getter(string $name, string $type, string $value): string
{
    return "$type get_$name(void) { return $value; }";
}
