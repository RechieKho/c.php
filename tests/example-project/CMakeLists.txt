cmake_minimum_required(VERSION 3.20)
if(NOT COMMAND cphp_add_sources)
  # Standalone configure: use the c.php checkout two levels up.
  project(cphp_example LANGUAGES C)
  add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/../.." cphp)
else()
  project(cphp_example LANGUAGES C)
endif()

add_executable(example main.c)
cphp_add_sources(example table.c.php)
target_include_directories(example PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")

enable_testing()
add_test(NAME example COMMAND example)
