cmake_minimum_required(VERSION 3.20)
project(cphp VERSION 0.1.0 LANGUAGES NONE)

set(CPHP_ROOT_DIR "${CMAKE_CURRENT_LIST_DIR}" CACHE INTERNAL "cphp source root")

include("${CMAKE_CURRENT_LIST_DIR}/cmake/CPhp.cmake")

# Only build the example when cphp is the top-level project.
if(PROJECT_IS_TOP_LEVEL AND EXISTS "${CMAKE_CURRENT_LIST_DIR}/tests/example-project/CMakeLists.txt")
  option(CPHP_BUILD_EXAMPLES "Build tests/example-project" OFF)
  if(CPHP_BUILD_EXAMPLES)
    add_subdirectory(tests/example-project)
  endif()
endif()
