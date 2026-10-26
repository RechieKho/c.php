'use strict';
// Build-directory discovery for the extension. No `vscode` import so it is unit-testable.
const fs = require('fs');
const path = require('path');

const DB = 'compile_commands.json';
const hasDb = (dir) => { try { return fs.statSync(path.join(dir, DB)).isFile(); } catch (_) { return false; } };
const mtime = (dir) => { try { return fs.statSync(path.join(dir, DB)).mtimeMs; } catch (_) { return 0; } };
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)); } catch (_) { return []; } };

function expand(value, folder) {
  return value
    .replace(/\$\{workspaceFolder\}/g, folder)
    .replace(/\$\{workspaceFolderBasename\}/g, path.basename(folder))
    .replace(/\$\{(?:buildType|buildKit|generator|[a-zA-Z:]+)\}/g, '*');   // unknown variables become globs below
}

/** Resolve a path that may contain `*` segments to existing directories. */
function globDirs(p) {
  const parts = p.split(path.sep);
  let cur = [parts[0] === '' ? path.sep : parts[0]];
  for (const part of parts.slice(1)) {
    if (part === '') continue;
    const next = [];
    for (const base of cur) {
      if (part.includes('*')) {
        const re = new RegExp('^' + part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        for (const d of subdirs(base)) if (re.test(path.basename(d))) next.push(d);
      } else next.push(path.join(base, part));
    }
    cur = next;
  }
  return cur;
}

/**
 * @param {string} folder workspace folder
 * @param {{buildDirectory?: string, cmakeBuildDirectory?: string}} cfg
 * @returns {string|null} directory containing compile_commands.json
 */
function findBuildDir(folder, cfg = {}) {
  const resolve = (v) => (path.isAbsolute(v) ? v : path.join(folder, v));
  if (cfg.buildDirectory) {
    const d = resolve(expand(cfg.buildDirectory, folder));
    return hasDb(d) ? d : null;   // an explicit setting is never second-guessed
  }
  const candidates = [];
  if (cfg.cmakeBuildDirectory) candidates.push(...globDirs(resolve(expand(cfg.cmakeBuildDirectory, folder))));
  candidates.push(folder, path.join(folder, 'build'));
  for (const root of ['build', 'out/build', 'out', 'cmake-build-debug', 'cmake-build-release']) candidates.push(...subdirs(path.join(folder, root)));
  for (const d of subdirs(folder)) if (/^(build|cmake-build)/.test(path.basename(d))) candidates.push(d);
  const found = [...new Set(candidates)].filter(hasDb);
  if (!found.length) return null;
  // The cmake-tools directory wins if it has a database; otherwise the freshest one.
  if (cfg.cmakeBuildDirectory && globDirs(resolve(expand(cfg.cmakeBuildDirectory, folder))).includes(found[0])) return found[0];
  return found.sort((a, b) => mtime(b) - mtime(a))[0];
}

/**
 * Like findBuildDir, but also works without a workspace folder: tries `folder` (if any),
 * then each ancestor of the document's directory (up to 8 levels).
 */
function findBuildDirFor(docPath, folder, cfg = {}) {
  const roots = [];
  if (folder) roots.push(folder);
  for (let d = path.dirname(docPath), i = 0; i < 8; i++, d = path.dirname(d)) {
    roots.push(d);
    if (path.dirname(d) === d) break;
  }
  for (const r of [...new Set(roots)]) {
    const found = findBuildDir(r, r === folder ? cfg : { ...cfg, buildDirectory: '' });
    if (found) return found;
  }
  return null;
}

/** Proxy and shadow script: the repo checkout when present (development), else the copies staged into the .vsix. */
function findServer(extDir) {
  const repo = { proxy: path.join(extDir, '..', 'lsp-proxy', 'cphp-lsp-proxy.js'), shadow: path.join(extDir, '..', '..', 'bin', 'cphp-shadow.php') };
  const staged = { proxy: path.join(extDir, 'server', 'cphp-lsp-proxy.js'), shadow: path.join(extDir, 'server', 'cphp-shadow.php') };
  for (const c of [repo, staged]) if (fs.existsSync(c.proxy) && fs.existsSync(c.shadow)) return c;
  return null;
}

/** Is `cmd` an executable on PATH? */
function onPath(cmd, env = process.env, platform = process.platform) {
  const exts = platform === 'win32' ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const d of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!d) continue;
    for (const x of exts) { try { if (fs.statSync(path.join(d, cmd + x)).isFile()) return true; } catch (_) { /* next */ } }
  }
  return false;
}

/** Intelephense installed by the extension into `dir` (npm --prefix): run with node, which also works on Windows. */
function localIntelephense(dir) {
  const js = path.join(dir, 'node_modules', 'intelephense', 'lib', 'intelephense.js');
  try { return fs.statSync(js).isFile() ? js : null; } catch (_) { return null; }
}

module.exports = { findBuildDirFor, findBuildDir, findServer, expand, onPath, localIntelephense };
