include_guard(GLOBAL)

if(NOT CPHP_ROOT_DIR)
  get_filename_component(CPHP_ROOT_DIR "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()

set(CPHP_EXPANDER "${CPHP_ROOT_DIR}/bin/cphp.php" CACHE FILEPATH "cphp expander script")

find_program(CPHP_PHP_EXECUTABLE php DOC "PHP CLI (>= 8.0)")

# cphp_add_sources(<target> <template>...)
#
# Expands each *.c.php template to <build>/cphp/<relpath-without-.php> and adds
# the result to <target>. Relative paths are resolved against the calling
# CMakeLists.txt directory.
function(cphp_add_sources target)
  if(NOT CPHP_PHP_EXECUTABLE)
    message(FATAL_ERROR "cphp: PHP CLI (>= 8.0) not found; set CPHP_PHP_EXECUTABLE.")
  endif()
  if(NOT EXISTS "${CPHP_EXPANDER}")
    message(FATAL_ERROR "cphp: expander not found at ${CPHP_EXPANDER} (not implemented yet).")
  endif()

  set(outputs)
  foreach(template IN LISTS ARGN)
    cmake_path(ABSOLUTE_PATH template BASE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" NORMALIZE OUTPUT_VARIABLE abs)
    cmake_path(RELATIVE_PATH abs BASE_DIRECTORY "${CMAKE_SOURCE_DIR}" OUTPUT_VARIABLE rel)
    string(REGEX REPLACE "\\.php$" "" rel_out "${rel}")
    set(out "${CMAKE_BINARY_DIR}/cphp/${rel_out}")
    cmake_path(GET out PARENT_PATH out_dir)

    add_custom_command(
      OUTPUT "${out}"
      COMMAND "${CMAKE_COMMAND}" -E make_directory "${out_dir}"
      COMMAND "${CPHP_PHP_EXECUTABLE}" -d short_open_tag=0 "${CPHP_EXPANDER}"
              "${abs}" "${out}" --depfile "${out}.d" --map "${out}.map"
      DEPENDS "${abs}" "${CPHP_EXPANDER}"
      DEPFILE "${out}.d"
      COMMENT "cphp: expanding ${rel}"
      VERBATIM)
    list(APPEND outputs "${out}")
  endforeach()

  target_sources(${target} PRIVATE ${outputs})
endfunction()
