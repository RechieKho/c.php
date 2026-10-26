#include "table.h"

int main(void) {
  return (op_add(2, 3) == 5 && op_sub(5, 3) == 2 && op_mul(2, 3) == 6) ? 0 : 1;
}
