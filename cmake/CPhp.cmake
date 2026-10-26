include_guard(GLOBAL)

if(NOT CPHP_ROOT_DIR)
  get_filename_component(CPHP_ROOT_DIR "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()

set(CPHP_EXPANDER "${CPHP_ROOT_DIR}/bin/cphp.php" CACHE FILEPATH "cphp expander script")

find_program(CPHP_PHP_EXECUTABLE php DOC "PHP CLI (>= 8.0)")

# Version of the expander/editor tooling shipped in this tree (must match bin/cphp.php).
set(CPHP_VERSION "0.1.0" CACHE INTERNAL "cphp module version")
# Marketplace + Open VSX ID (publisher is a placeholder until the extension is published).
set(CPHP_VSCODE_EXTENSION_ID "rechiekho.cphp" CACHE STRING "VS Code extension ID recommended/installed by cphp_setup_vscode")

if(NOT DEFINED CPHP_INSTALL)
  set(_cphp_install_default OFF)
  if(PROJECT_IS_TOP_LEVEL)
    set(_cphp_install_default ON)
  endif()
  option(CPHP_INSTALL "Install PHP dirs registered with cphp_export_php()" ${_cphp_install_default})
endif()

# Expander and module must come from the same tree.
function(_cphp_check_expander_version)
  if(_CPHP_VERSION_CHECKED OR NOT CPHP_PHP_EXECUTABLE OR NOT EXISTS "${CPHP_EXPANDER}")
    return()
  endif()
  execute_process(COMMAND "${CPHP_PHP_EXECUTABLE}" "${CPHP_EXPANDER}" --version
    OUTPUT_VARIABLE out OUTPUT_STRIP_TRAILING_WHITESPACE RESULT_VARIABLE rc ERROR_QUIET)
  if(NOT rc EQUAL 0 OR NOT out STREQUAL "cphp ${CPHP_VERSION}")
    message(FATAL_ERROR "cphp: expander version mismatch (module ${CPHP_VERSION}, expander '${out}'). "
      "CPHP_EXPANDER=${CPHP_EXPANDER}")
  endif()
  set(_CPHP_VERSION_CHECKED TRUE CACHE INTERNAL "")
endfunction()

# cphp_export_php(<target> DIRECTORY <dir> [NAME <lib>])
#
# Makes <dir> importable as cphp('<lib>/file.php') from templates of any target
# that links <target>. NAME defaults to the target name.
function(cphp_export_php target)
  cmake_parse_arguments(PARSE_ARGV 1 ARG "" "DIRECTORY;NAME" "")
  if(NOT TARGET ${target})
    message(FATAL_ERROR "cphp_export_php: '${target}' is not a target.")
  endif()
  if(NOT ARG_DIRECTORY)
    message(FATAL_ERROR "cphp_export_php: DIRECTORY is required.")
  endif()
  if(NOT ARG_NAME)
    set(ARG_NAME "${target}")
  endif()
  if(NOT ARG_NAME MATCHES "^[A-Za-z0-9_.-]+$")
    message(FATAL_ERROR "cphp_export_php: NAME '${ARG_NAME}' must match [A-Za-z0-9_.-]+.")
  endif()
  cmake_path(ABSOLUTE_PATH ARG_DIRECTORY BASE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" NORMALIZE)
  if(NOT IS_DIRECTORY "${ARG_DIRECTORY}")
    message(FATAL_ERROR "cphp_export_php: '${ARG_DIRECTORY}' is not a directory.")
  endif()
  file(REAL_PATH "${ARG_DIRECTORY}" real)

  get_property(owner GLOBAL PROPERTY CPHP_LIB_DIR_${ARG_NAME})
  if(owner AND NOT owner STREQUAL real)
    message(FATAL_ERROR
      "cphp_export_php: library name '${ARG_NAME}' is already registered for ${owner}, "
      "cannot also be ${real}.")
  endif()
  set_property(GLOBAL PROPERTY CPHP_LIB_DIR_${ARG_NAME} "${real}")

  # In-tree: plain property. Exported (CMake forbids genex in exported custom
  # properties): a `$<0:...>` entry in INTERFACE_LINK_LIBRARIES, which evaluates to
  # nothing at build time but carries the install path to imported targets.
  set_property(TARGET ${target} APPEND PROPERTY CPHP_LIBS "${ARG_NAME}=${real}")
  set_property(TARGET ${target} APPEND PROPERTY INTERFACE_LINK_LIBRARIES
    "$<0:cphp:${ARG_NAME}=$<BUILD_INTERFACE:${real}>$<INSTALL_INTERFACE:$<INSTALL_PREFIX>/share/cphp/${ARG_NAME}>>")

  if(CPHP_INSTALL)
    install(DIRECTORY "${ARG_DIRECTORY}/" DESTINATION "share/cphp/${ARG_NAME}")
  endif()
endfunction()

# Raw NAME=path entries of property <prop> over the link closure of <target>.
# <tag> is the marker used in the exported `$<0:tag:NAME=path>` entries.
function(_cphp_collect_entries target prop tag out)
  set(queue "${target}")
  set(seen)
  set(result)
  while(queue)
    list(POP_FRONT queue t)
    if(t IN_LIST seen)
      continue()
    endif()
    list(APPEND seen "${t}")
    get_target_property(imported ${t} IMPORTED)
    set(next)
    get_target_property(il ${t} INTERFACE_LINK_LIBRARIES)
    if(il)
      list(APPEND next ${il})
    endif()
    if(imported)
      # Imported (find_package): entries exported by cphp_export_php().
      foreach(n IN LISTS il)
        if(n MATCHES "^\\$<0:${tag}:([^=]+=[^>$]+)>$")
          list(APPEND result "${CMAKE_MATCH_1}")
        endif()
      endforeach()
    else()
      get_target_property(libs ${t} ${prop})
      if(libs)
        list(APPEND result ${libs})
      endif()
    endif()
    if(NOT imported AND t STREQUAL target)
      get_target_property(ll ${t} LINK_LIBRARIES)
      if(ll)
        list(APPEND next ${ll})
      endif()
    endif()
    foreach(n IN LISTS next)
      # $<LINK_ONLY:x> / $<BUILD_INTERFACE:x> wrappers
      if(n MATCHES "^\\$<(LINK_ONLY|BUILD_INTERFACE):([^>$]*)>$")
        set(n "${CMAKE_MATCH_2}")
      endif()
      if(TARGET "${n}")
        list(APPEND queue "${n}")
      endif()
    endforeach()
  endwhile()
  list(REMOVE_DUPLICATES result)
  set(${out} "${result}" PARENT_SCOPE)
endfunction()

# Entries -> deduplicated NAME=realpath list; one NAME with two paths is an error.
function(_cphp_resolve_entries what result out)
  set(names)
  foreach(entry IN LISTS result)
    string(FIND "${entry}" "=" eq)
    string(SUBSTRING "${entry}" 0 ${eq} name)
    math(EXPR eq "${eq}+1")
    string(SUBSTRING "${entry}" ${eq} -1 path)
    if(EXISTS "${path}")
      file(REAL_PATH "${path}" real)
    else()
      set(real "${path}")
    endif()
    if(DEFINED seen_${name} AND NOT seen_${name} STREQUAL real)
      message(FATAL_ERROR "cphp: ${what} '${name}' resolves to two different paths:\n  ${seen_${name}}\n  ${real}")
    endif()
    set(seen_${name} "${real}")
    if(NOT name IN_LIST names)
      list(APPEND names "${name}")
    endif()
  endforeach()
  set(final)
  foreach(name IN LISTS names)
    list(APPEND final "${name}=${seen_${name}}")
  endforeach()
  set(${out} "${final}" PARENT_SCOPE)
endfunction()

function(_cphp_collect_libs target out)
  _cphp_collect_entries(${target} CPHP_LIBS cphp raw)
  _cphp_resolve_entries("library" "${raw}" res)
  set(${out} "${res}" PARENT_SCOPE)
endfunction()

function(_cphp_collect_composer target out)
  _cphp_collect_entries(${target} CPHP_COMPOSER cphpc raw)
  _cphp_resolve_entries("Composer package" "${raw}" res)
  set(${out} "${res}" PARENT_SCOPE)
endfunction()

# Runs once per directory at the end of its CMakeLists.txt: writes
# <binary-dir>/cphp/libs.json and checks libs were linked before cphp_add_sources().
function(_cphp_finalize_directory)
  get_property(targets DIRECTORY PROPERTY CPHP_TARGETS)
  set(entries)
  foreach(t IN LISTS targets)
    get_property(used GLOBAL PROPERTY CPHP_LIBS_USED_${t})
    _cphp_collect_libs(${t} now)
    if(NOT "${used}" STREQUAL "${now}")
      message(FATAL_ERROR
        "cphp: target '${t}' links PHP libraries after cphp_add_sources() was called "
        "(used: [${used}], now: [${now}]). Call target_link_libraries() first.")
    endif()
    list(APPEND entries ${now})
    get_property(cused GLOBAL PROPERTY CPHP_COMPOSER_USED_${t})
    _cphp_collect_composer(${t} cnow)
    if(NOT "${cused}" STREQUAL "${cnow}")
      message(FATAL_ERROR
        "cphp: target '${t}' gained Composer participants after cphp_add_sources() was called "
        "(used: [${cused}], now: [${cnow}]). Call cphp_use_composer()/target_link_libraries() first.")
    endif()
  endforeach()
  list(REMOVE_DUPLICATES entries)
  set(json_libs)
  foreach(entry IN LISTS entries)
    string(FIND "${entry}" "=" eq)
    string(SUBSTRING "${entry}" 0 ${eq} name)
    math(EXPR eq "${eq}+1")
    string(SUBSTRING "${entry}" ${eq} -1 path)
    list(APPEND json_libs "    \"${name}\": \"${path}\"")
  endforeach()
  list(JOIN json_libs ",\n" body)
  file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/cphp/libs.json"
    CONTENT "{\n  \"cphpVersion\": \"${CPHP_VERSION}\",\n  \"libs\": {\n${body}\n  }\n}\n")
endfunction()

# ---------------------------------------------------------------------------
# Composer (spec 4.3)
# ---------------------------------------------------------------------------

set(CPHP_COMPOSER_EXECUTABLE "" CACHE FILEPATH "Composer executable (composer, composer.phar)")
option(CPHP_COMPOSER_UPDATE "Run `composer update` and rewrite the lock instead of failing on a missing/stale one" OFF)

# cphp_use_composer(<target> [JSON <composer.json>] [LOCK <composer.lock>] [ALLOW_SCRIPTS])
#
# Registers <target>'s composer.json as a participant in the merged root used by
# every target that links it (and by <target>'s own cphp_add_sources). LOCK
# (default <source-dir>/composer.lock) is the lock owned by <target>.
function(cphp_use_composer target)
  cmake_parse_arguments(PARSE_ARGV 1 ARG "ALLOW_SCRIPTS" "JSON;LOCK" "")
  if(NOT TARGET ${target})
    message(FATAL_ERROR "cphp_use_composer: '${target}' is not a target.")
  endif()
  if(NOT ARG_JSON)
    set(ARG_JSON "composer.json")
  endif()
  cmake_path(ABSOLUTE_PATH ARG_JSON BASE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" NORMALIZE)
  if(NOT EXISTS "${ARG_JSON}")
    message(FATAL_ERROR "cphp_use_composer: ${ARG_JSON} does not exist.")
  endif()
  cmake_path(GET ARG_JSON FILENAME fname)
  if(NOT fname STREQUAL "composer.json")
    message(FATAL_ERROR "cphp_use_composer: JSON must be a file named composer.json (got ${fname}).")
  endif()
  if(NOT ARG_LOCK)
    set(ARG_LOCK "composer.lock")
  endif()
  cmake_path(ABSOLUTE_PATH ARG_LOCK BASE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" NORMALIZE)

  file(READ "${ARG_JSON}" json)
  string(JSON pkg_name ERROR_VARIABLE err GET "${json}" name)
  if(err OR pkg_name STREQUAL "")
    message(FATAL_ERROR "cphp_use_composer: ${ARG_JSON} must have a \"name\" (vendor/package).")
  endif()
  cmake_path(GET ARG_JSON PARENT_PATH dir)
  file(REAL_PATH "${dir}" real)

  set_property(TARGET ${target} APPEND PROPERTY CPHP_COMPOSER "${pkg_name}=${real}")
  set_property(TARGET ${target} APPEND PROPERTY INTERFACE_LINK_LIBRARIES
    "$<0:cphpc:${pkg_name}=$<BUILD_INTERFACE:${real}>$<INSTALL_INTERFACE:$<INSTALL_PREFIX>/share/cphp/composer/${pkg_name}>>")
  set_property(GLOBAL PROPERTY CPHP_COMPOSER_LOCK_${target} "${ARG_LOCK}")
  set_property(GLOBAL PROPERTY CPHP_COMPOSER_SCRIPTS_${target} "${ARG_ALLOW_SCRIPTS}")
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${ARG_JSON}")
  if(EXISTS "${ARG_LOCK}")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${ARG_LOCK}")
  endif()

  if(CPHP_INSTALL)
    install(DIRECTORY "${dir}/" DESTINATION "share/cphp/composer/${pkg_name}"
      PATTERN "vendor" EXCLUDE PATTERN ".git" EXCLUDE PATTERN "build" EXCLUDE)
  endif()
endfunction()

# Files that make up a participant (composer.json + PHP sources), excluding
# vendor/, VCS and build directories.
function(_cphp_composer_files dir out)
  file(GLOB_RECURSE files "${dir}/*.php" "${dir}/composer.json")
  list(FILTER files EXCLUDE REGEX "/(vendor|\\.git|node_modules)/")
  set(kept)
  foreach(f IN LISTS files)
    string(FIND "${f}" "${CMAKE_BINARY_DIR}/" in_build)
    if(NOT in_build EQUAL 0)
      list(APPEND kept "${f}")
    endif()
  endforeach()
  list(SORT kept)
  set(${out} "${kept}" PARENT_SCOPE)
endfunction()

function(_cphp_composer_find)
  if(CPHP_COMPOSER_EXECUTABLE)
    return()
  endif()
  find_program(_cphp_composer NAMES composer composer.bat composer.phar)
  if(NOT _cphp_composer)
    message(FATAL_ERROR
      "cphp: Composer not found but cphp_use_composer() is in use. Install it "
      "(https://getcomposer.org/download/, `brew install composer`) or set -DCPHP_COMPOSER_EXECUTABLE=...")
  endif()
  set(CPHP_COMPOSER_EXECUTABLE "${_cphp_composer}" CACHE FILEPATH "" FORCE)
endfunction()

# Builds (once per distinct participant set) the merged root and installs it.
# Outputs: <autoload> the vendor/autoload.php path, <stamp> a file touched on reinstall.
function(_cphp_composer_prepare target participants autoload stamp)
  get_property(lock GLOBAL PROPERTY CPHP_COMPOSER_LOCK_${target})
  if(NOT lock)
    message(FATAL_ERROR
      "cphp: target '${target}' uses Composer packages (from linked libraries) but never called "
      "cphp_use_composer(${target}); it must own the lock file.")
  endif()
  get_property(scripts GLOBAL PROPERTY CPHP_COMPOSER_SCRIPTS_${target})
  list(SORT participants)
  string(SHA256 hash "${participants}|${lock}|${scripts}")
  string(SUBSTRING "${hash}" 0 12 hash)
  set(root "${CMAKE_CURRENT_BINARY_DIR}/cphp/composer/${hash}")
  set(${autoload} "${root}/vendor/autoload.php" PARENT_SCOPE)
  set(${stamp} "${root}/cphp-install.stamp" PARENT_SCOPE)
  get_property(done GLOBAL PROPERTY CPHP_COMPOSER_ROOT_${hash})
  if(done)
    return()
  endif()
  set_property(GLOBAL PROPERTY CPHP_COMPOSER_ROOT_${hash} TRUE)

  _cphp_composer_find()

  # Participants are staged as copies under <root>/participants/<name> and referenced by
  # relative path. That keeps the root's content-hash (which Composer stores in the
  # lock and which covers `repositories`) identical on every machine and build dir,
  # and gives path repos a stable version (no .git of the source tree involved).
  set(repos)
  set(requires)
  set(file_hashes)
  set(json_hashes)   # participants' composer.json: goes into root `extra` so Composer's lock hash covers them
  set(staged)   # "<abs src>|<relpath within participant>|<name>"
  foreach(entry IN LISTS participants)
    string(FIND "${entry}" "=" eq)
    string(SUBSTRING "${entry}" 0 ${eq} name)
    math(EXPR eq "${eq}+1")
    string(SUBSTRING "${entry}" ${eq} -1 path)
    list(APPEND repos "    {\"type\": \"path\", \"url\": \"participants/${name}\", \"options\": {\"symlink\": false}}")
    list(APPEND requires "    \"${name}\": \"@dev\"")
    _cphp_composer_files("${path}" pfiles)
    foreach(f IN LISTS pfiles)
      file(SHA256 "${f}" h)
      file(RELATIVE_PATH rel "${path}" "${f}")
      list(APPEND file_hashes "${name}/${rel}:${h}")
      if(rel STREQUAL "composer.json")
        list(APPEND json_hashes "${name}:${h}")
      endif()
      list(APPEND staged "${f}|${rel}|${name}")
    endforeach()
    # Edits to participant files must re-run configure so the staged copy is refreshed.
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${pfiles})
  endforeach()
  list(JOIN repos ",\n" repos_s)
  list(JOIN requires ",\n" requires_s)
  string(SHA256 fingerprint "${json_hashes}")
  set(plugins "false")
  if(scripts)
    set(plugins "true")
  endif()
  set(content "{
  \"name\": \"cphp/root\",
  \"description\": \"generated by cphp; do not edit\",
  \"minimum-stability\": \"dev\",
  \"prefer-stable\": true,
  \"repositories\": [
${repos_s}
  ],
  \"require\": {
${requires_s}
  },
  \"config\": {\"allow-plugins\": ${plugins}},
  \"extra\": {\"cphp\": {\"participants\": \"${fingerprint}\"}}
}
")

  # Stamp: root + lock + participant sources.
  set(lock_hash "none")
  if(EXISTS "${lock}")
    file(SHA256 "${lock}" lock_hash)
  endif()
  string(SHA256 want "${content}|${lock_hash}|${file_hashes}")
  set(stamp_file "${root}/cphp-install.stamp")
  set(have "")
  if(EXISTS "${stamp_file}")
    file(READ "${stamp_file}" have)
  endif()
  if(have STREQUAL want AND EXISTS "${root}/vendor/autoload.php")
    return()
  endif()

  if(NOT EXISTS "${lock}" AND NOT CPHP_COMPOSER_UPDATE)
    message(FATAL_ERROR
      "cphp: ${lock} is missing. Run once with -DCPHP_COMPOSER_UPDATE=ON to create it, then commit it.")
  endif()

  # Fresh stage (also forces a re-copy: Composer keeps a locked path package whose
  # reference is unchanged).
  file(REMOVE_RECURSE "${root}/vendor" "${root}/participants")
  file(MAKE_DIRECTORY "${root}")
  file(WRITE "${root}/composer.json" "${content}")
  foreach(item IN LISTS staged)
    string(REPLACE "|" ";" parts "${item}")
    list(GET parts 0 src)
    list(GET parts 1 rel)
    list(GET parts 2 name)
    get_filename_component(sub "${rel}" DIRECTORY)
    file(MAKE_DIRECTORY "${root}/participants/${name}/${sub}")
    file(COPY_FILE "${src}" "${root}/participants/${name}/${rel}")
  endforeach()

  set(flags --no-interaction --no-dev --no-progress --no-ansi)
  if(NOT scripts)
    list(APPEND flags --no-scripts --no-plugins)
  endif()
  set(cmd "${CPHP_COMPOSER_EXECUTABLE}")
  if(cmd MATCHES "\\.phar$")
    set(cmd "${CPHP_PHP_EXECUTABLE}" "${cmd}")
  endif()
  set(action install)
  if(CPHP_COMPOSER_UPDATE)
    set(action update)
  else()
    file(COPY_FILE "${lock}" "${root}/composer.lock")
    execute_process(COMMAND ${cmd} validate --check-lock --no-check-publish --no-check-all --no-ansi
      WORKING_DIRECTORY "${root}" RESULT_VARIABLE vrc OUTPUT_VARIABLE vout ERROR_VARIABLE verr)
    if(NOT vrc EQUAL 0)
      message(FATAL_ERROR
        "cphp: ${lock} is stale for target '${target}' (a participant's composer.json changed).\n"
        "${vout}${verr}\nRe-run configure once with -DCPHP_COMPOSER_UPDATE=ON and commit the lock.")
    endif()
  endif()
  message(STATUS "cphp: composer ${action} for ${target} (${hash})")
  execute_process(COMMAND ${cmd} ${action} ${flags}
    WORKING_DIRECTORY "${root}" RESULT_VARIABLE rc OUTPUT_VARIABLE out ERROR_VARIABLE err)
  if(NOT rc EQUAL 0)
    message(FATAL_ERROR
      "cphp: composer ${action} failed for ${target}:\n${out}${err}\n"
      "A conflict means two participants need incompatible versions: loosen a "
      "constraint or pin the package in ${lock}'s owner. A stale lock: re-run with "
      "-DCPHP_COMPOSER_UPDATE=ON.")
  endif()
  if(CPHP_COMPOSER_UPDATE)
    file(COPY_FILE "${root}/composer.lock" "${lock}")
    file(SHA256 "${lock}" lock_hash)
    string(SHA256 want "${content}|${lock_hash}|${file_hashes}")
    message(STATUS "cphp: wrote ${lock}")
  endif()
  file(WRITE "${stamp_file}" "${want}")
endfunction()

# cphp_add_sources(<target> <template>...)
#
# Expands each *.c.php template to
#   ${CMAKE_CURRENT_BINARY_DIR}/cphp/<relpath-without-.php>
# (relpath is relative to CMAKE_CURRENT_SOURCE_DIR) and adds the result to
# <target>. Also writes <out>.d (depfile) and <out>.map (source map).
function(cphp_add_sources target)
  if(NOT CPHP_PHP_EXECUTABLE)
    message(FATAL_ERROR
      "cphp: PHP CLI (>= 8.0) not found. Install it (e.g. `brew install php`, "
      "`apt install php-cli`, `choco install php`) or set -DCPHP_PHP_EXECUTABLE=/path/to/php.")
  endif()
  if(NOT EXISTS "${CPHP_EXPANDER}")
    message(FATAL_ERROR "cphp: expander not found at ${CPHP_EXPANDER}.")
  endif()
  if(NOT TARGET ${target})
    message(FATAL_ERROR "cphp_add_sources: '${target}' is not a target.")
  endif()
  # Editors read compile_commands.json for the generated siblings. The variable does
  # not propagate from a FetchContent subproject, but the target property does.
  # (an empty value means "unset"; an explicit OFF is respected)
  get_property(_cphp_ecc TARGET ${target} PROPERTY EXPORT_COMPILE_COMMANDS)
  if("${_cphp_ecc}" STREQUAL "")
    set_property(TARGET ${target} PROPERTY EXPORT_COMPILE_COMMANDS ON)
  endif()

  _cphp_check_expander_version()

  _cphp_collect_libs(${target} libs)
  set_property(GLOBAL PROPERTY CPHP_LIBS_USED_${target} "${libs}")
  set(lib_args)
  foreach(entry IN LISTS libs)
    list(APPEND lib_args --lib "${entry}")
  endforeach()
  _cphp_collect_composer(${target} composer_pkgs)
  set_property(GLOBAL PROPERTY CPHP_COMPOSER_USED_${target} "${composer_pkgs}")
  set(autoload_args)
  set(composer_deps)
  if(composer_pkgs)
    _cphp_composer_prepare(${target} "${composer_pkgs}" autoload_file composer_stamp)
    set(autoload_args --autoload "${autoload_file}")
    get_property(lock GLOBAL PROPERTY CPHP_COMPOSER_LOCK_${target})
    set(composer_deps "${composer_stamp}")
  endif()
  get_property(registered DIRECTORY PROPERTY CPHP_TARGETS)
  if(NOT registered)
    cmake_language(DEFER CALL _cphp_finalize_directory)
  endif()
  if(NOT target IN_LIST registered)
    set_property(DIRECTORY APPEND PROPERTY CPHP_TARGETS ${target})
  endif()

  # Visual Studio generators ignore DEPFILE: PHP includes are not tracked there.
  set(use_depfile TRUE)
  if(CMAKE_GENERATOR MATCHES "Visual Studio")
    set(use_depfile FALSE)
    get_property(warned GLOBAL PROPERTY CPHP_WARNED_NO_DEPFILE)
    if(NOT warned)
      message(WARNING
        "cphp: the ${CMAKE_GENERATOR} generator does not support DEPFILE, so files "
        "included by a template (PHP require/include) will not trigger re-expansion. "
        "Use the Ninja generator for correct incremental builds.")
      set_property(GLOBAL PROPERTY CPHP_WARNED_NO_DEPFILE TRUE)
    endif()
  endif()

  set(outputs)
  foreach(template IN LISTS ARGN)
    cmake_path(ABSOLUTE_PATH template BASE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" NORMALIZE OUTPUT_VARIABLE abs)
    cmake_path(RELATIVE_PATH abs BASE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" OUTPUT_VARIABLE rel)
    if(rel MATCHES "^\\.\\.")
      message(FATAL_ERROR
        "cphp_add_sources: template '${abs}' is outside ${CMAKE_CURRENT_SOURCE_DIR}.")
    endif()
    if(NOT rel MATCHES "\\.php$")
      message(FATAL_ERROR "cphp_add_sources: template '${rel}' must end in .php (e.g. foo.c.php).")
    endif()
    string(REGEX REPLACE "\\.php$" "" rel_out "${rel}")
    set(out "${CMAKE_CURRENT_BINARY_DIR}/cphp/${rel_out}")
    cmake_path(GET out PARENT_PATH out_dir)

    set(depfile_args)
    if(use_depfile)
      set(depfile_args DEPFILE "${out}.d")
    endif()

    add_custom_command(
      OUTPUT "${out}"
      COMMAND "${CMAKE_COMMAND}" -E make_directory "${out_dir}"
      COMMAND "${CPHP_PHP_EXECUTABLE}" -d short_open_tag=0 "${CPHP_EXPANDER}"
              "${abs}" "${out}" --depfile "${out}.d" --map "${out}.map" ${lib_args} ${autoload_args}
      DEPENDS "${abs}" "${CPHP_EXPANDER}" ${composer_deps}
      ${depfile_args}
      COMMENT "cphp: expanding ${rel}"
      VERBATIM)
    set_source_files_properties("${out}" PROPERTIES GENERATED TRUE)
    list(APPEND outputs "${out}")
  endforeach()

  target_sources(${target} PRIVATE ${outputs})
endfunction()

# cphp_setup_vscode([INSTALL] [EDITORS <cli>...])
#
# Top-level projects only, never in CI. Always recommends the extension in
# .vscode/extensions.json; with INSTALL (or -DCPHP_VSCODE_AUTO_INSTALL=ON) also
# installs it through an editor CLI. Failures are warnings.
function(cphp_setup_vscode)
  cmake_parse_arguments(PARSE_ARGV 0 ARG "INSTALL" "" "EDITORS")
  if(NOT PROJECT_IS_TOP_LEVEL OR DEFINED ENV{CI} OR (DEFINED CPHP_VSCODE_SETUP AND NOT CPHP_VSCODE_SETUP))
    return()
  endif()
  if(NOT ARG_EDITORS)
    set(ARG_EDITORS code code-insiders cursor codium)
  endif()
  set(id "${CPHP_VSCODE_EXTENSION_ID}")

  # 1. Recommend.
  set(file "${CMAKE_SOURCE_DIR}/.vscode/extensions.json")
  if(NOT EXISTS "${file}")
    file(WRITE "${file}" "{\n  \"recommendations\": [\"${id}\"]\n}\n")
    message(STATUS "cphp: created .vscode/extensions.json recommending ${id}")
  else()
    file(READ "${file}" json)
    string(JSON recs ERROR_VARIABLE err GET "${json}" recommendations)
    if(err)
      string(JSON n ERROR_VARIABLE err2 LENGTH "${json}")
      if(err2)
        message(WARNING "cphp: cannot parse ${file} (comments?); add \"${id}\" to recommendations by hand.")
      else()
        string(JSON json SET "${json}" recommendations "[\"${id}\"]")
        file(WRITE "${file}" "${json}\n")
      endif()
    else()
      string(JSON n LENGTH "${recs}")
      set(found FALSE)
      math(EXPR last "${n}-1")
      if(n GREATER 0)
        foreach(i RANGE ${last})
          string(JSON item GET "${recs}" ${i})
          string(TOLOWER "${item}" a)
          string(TOLOWER "${id}" b)
          if(a STREQUAL b)
            set(found TRUE)
          endif()
        endforeach()
      endif()
      if(NOT found)
        string(JSON json SET "${json}" recommendations ${n} "\"${id}\"")
        file(WRITE "${file}" "${json}\n")
        message(STATUS "cphp: added ${id} to .vscode/extensions.json")
      endif()
    endif()
  endif()

  # 2. Install (opt-in).
  if(NOT ARG_INSTALL AND NOT CPHP_VSCODE_AUTO_INSTALL)
    return()
  endif()
  set(stamp "${CMAKE_BINARY_DIR}/cphp/vscode-setup.stamp")
  set(want "${id}@${CPHP_VERSION}")
  set(installed_any FALSE)
  foreach(cli IN LISTS ARG_EDITORS)
    find_program(_cphp_cli_${cli} NAMES ${cli} ${cli}.cmd)
    if(NOT _cphp_cli_${cli})
      continue()
    endif()
    set(found_any TRUE)
    if(EXISTS "${stamp}")
      file(STRINGS "${stamp}" stamped)
      if("${cli} ${want}" IN_LIST stamped)
        continue()
      endif()
    endif()
    execute_process(COMMAND "${_cphp_cli_${cli}}" --list-extensions --show-versions
      OUTPUT_VARIABLE listing RESULT_VARIABLE rc ERROR_QUIET)
    string(TOLOWER "${listing}" listing_l)
    string(TOLOWER "${id}" id_l)
    if(rc EQUAL 0 AND listing_l MATCHES "(^|\n)${id_l}@([0-9][^\n\r]*)")
      if(NOT CMAKE_MATCH_2 VERSION_LESS CPHP_VERSION)
        file(APPEND "${stamp}" "${cli} ${want}\n")
        continue()
      endif()
    endif()
    execute_process(COMMAND "${_cphp_cli_${cli}}" --install-extension "${want}" --force
      RESULT_VARIABLE rc OUTPUT_QUIET ERROR_VARIABLE errout)
    if(rc EQUAL 0)
      message(STATUS "cphp: installed ${want} into ${cli}")
      file(APPEND "${stamp}" "${cli} ${want}\n")
    else()
      message(WARNING "cphp: could not install ${want} into ${cli}: ${errout}")
    endif()
  endforeach()
  if(NOT found_any)
    message(STATUS "cphp: no editor CLI found (${ARG_EDITORS}); skipping extension install")
  endif()
endfunction()
