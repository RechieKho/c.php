# find_package(cphp) entry point for an installed c.php (<prefix>/share/cphp).
if(COMMAND cphp_add_sources)
  return()
endif()
get_filename_component(CPHP_ROOT_DIR "${CMAKE_CURRENT_LIST_DIR}" ABSOLUTE)
include("${CMAKE_CURRENT_LIST_DIR}/cmake/CPhp.cmake")
