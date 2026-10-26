#include "answer.h"
#include "gen/limits.h"
int get_double(void);
extern const char *legacy;
int main(void) {
  return (get_double() == 2 * answer() && PRODUCER_SIZE_SMALL == 4 && PRODUCER_SIZE_LARGE == 64 && legacy[0] == 'l' && legacy[6] == '!') ? 0 : 1;
}
