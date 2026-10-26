cmake_minimum_required(VERSION 3.20)

# One copy of c.php per build: the first declaration wins (spec 4.2).
if(COMMAND cphp_add_sources)
  return()
endif()

project(cphp VERSION 0.1.0 LANGUAGES NONE)

set(CPHP_ROOT_DIR "${CMAKE_CURRENT_LIST_DIR}" CACHE INTERNAL "cphp source root")

include("${CMAKE_CURRENT_LIST_DIR}/cmake/CPhp.cmake")

if(PROJECT_IS_TOP_LEVEL)
  include(CMakePackageConfigHelpers)

  # Layout under share/cphp mirrors the source tree so CPHP_ROOT_DIR works for both.
  install(FILES bin/cphp.php bin/cphp-shadow.php DESTINATION "share/cphp/bin")
  install(FILES cmake/CPhp.cmake DESTINATION "share/cphp/cmake")
  write_basic_package_version_file("${CMAKE_CURRENT_BINARY_DIR}/cphp-config-version.cmake"
    VERSION ${PROJECT_VERSION} COMPATIBILITY SameMajorVersion ARCH_INDEPENDENT)
  install(FILES cmake/cphp-config.cmake "${CMAKE_CURRENT_BINARY_DIR}/cphp-config-version.cmake"
    DESTINATION "share/cphp")

  option(CPHP_BUILD_EXAMPLES "Build tests/example-project" OFF)
  if(CPHP_BUILD_EXAMPLES AND EXISTS "${CMAKE_CURRENT_LIST_DIR}/tests/example-project/CMakeLists.txt")
    enable_language(C)
    enable_testing()
    add_subdirectory(tests/example-project)
    if(CPHP_PHP_EXECUTABLE)
      add_test(NAME cphp_shadow
        COMMAND "${CPHP_PHP_EXECUTABLE}" -d short_open_tag=0 "${CMAKE_CURRENT_LIST_DIR}/tests/shadow-test.php")
    endif()
  endif()
endif()
