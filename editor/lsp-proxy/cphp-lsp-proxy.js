#!/usr/bin/env node
'use strict';
/*
 * cphp LSP proxy (C side): sits between an editor and clangd.
 *
 *   cphp-lsp-proxy.js [--clangd PATH] [--php PATH] [--shadow PATH]
 *                     [--cphp-version V] [--phpls PATH [--phpls-arg ARG]...] [clangd args...]
 *
 * For `*.c.php` / `*.h.php` documents the proxy sends clangd the C shadow
 * (bin/cphp-shadow.php) instead of the template, opened under the generated
 * sibling URI (`<build>/.../cphp/<name>.c`, found via compile_commands.json) so
 * clangd uses the real compile flags. Shadows keep the template's line/column
 * layout, so positions pass through unchanged; only URIs are translated, both
 * ways. With --phpls (Intelephense, Phpactor, ...) the PHP shadow goes to that server
 * under the template's own URI; position requests are routed by region (PHP vs C text),
 * diagnostics and document symbols from both servers are merged. With --cphp-version, a
 * warning is shown when a build's libs.json was written by a different c.php version. Everything else is forwarded untouched.
 * No npm dependencies.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const WIN = process.platform === 'win32';
const opts = { version: null, phpls: null, phplsArgs: [], clangd: 'clangd', php: 'php', shadow: path.join(__dirname, '..', '..', 'bin', 'cphp-shadow.php'), rest: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--clangd') opts.clangd = process.argv[++i];
  else if (a === '--php') opts.php = process.argv[++i];
  else if (a === '--cphp-version') opts.version = process.argv[++i];
  else if (a === '--phpls') opts.phpls = process.argv[++i];
  else if (a === '--phpls-arg') opts.phplsArgs.push(process.argv[++i]);
  else if (a === '--shadow') opts.shadow = process.argv[++i];
  else if (a === '--stdio') continue;   // added by vscode-languageclient; clangd does not take it
  else opts.rest.push(a);
}
const ccdArg = opts.rest.find((a) => a.startsWith('--compile-commands-dir='));
const ccdir = ccdArg ? ccdArg.slice(ccdArg.indexOf('=') + 1) : null;

const log = (...a) => process.stderr.write('[cphp-proxy] ' + a.join(' ') + '\n');
const isTemplate = (uri) => /^file:/.test(uri) && /\.[ch]\.php$/i.test(uri.split(/[?#]/)[0]);
const norm = (uri) => { let s = uri; try { s = decodeURIComponent(uri); } catch (_) { /* keep */ } return WIN ? s.toLowerCase() : s; };
const fwd = (p) => p.replace(/\\/g, '/');
const cmpPath = (p) => (WIN ? fwd(p).toLowerCase() : fwd(p));

// ---- compile_commands.json: template path -> generated sibling path ----
let dbCache = { mtime: 0, files: [] };
function dbFiles() {
  if (!ccdir) return [];
  const f = path.join(ccdir, 'compile_commands.json');
  try {
    const m = fs.statSync(f).mtimeMs;
    if (m !== dbCache.mtime) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      dbCache = { mtime: m, files: j.map((e) => path.resolve(e.directory || '', e.file)).filter((p) => /[\\/]cphp[\\/]/.test(p)) };
    }
  } catch (_) { /* no DB yet */ }
  return dbCache.files;
}
function siblingFor(tplPath) {
  const t = cmpPath(tplPath);
  let best = [], bestLen = 0;
  for (const gen of dbFiles()) {
    const g = fwd(gen);
    for (let i = g.indexOf('/cphp/'); i >= 0; i = g.indexOf('/cphp/', i + 1)) {
      const rel = g.slice(i + 6);
      const suffix = cmpPath('/' + rel + '.php');
      if (t.endsWith(suffix)) {
        if (rel.length > bestLen) { best = [gen]; bestLen = rel.length; } else if (rel.length === bestLen) best.push(gen);
        break;
      }
    }
  }
  if (best.length > 1) {   // same relative name in several dirs: the generated file's first #line names its template
    for (const gen of best) {
      try {
        const first = fs.readFileSync(gen, 'utf8').split('\n', 1)[0];
        if (cmpPath(first).includes(t)) return gen;
      } catch (_) { /* not built yet */ }
    }
  }
  return best[0] || null;
}
function virtualSibling(tplPath) {
  const m = /^(.*)\.([ch])\.php$/i.exec(tplPath);
  return m ? `${m[1]}.cphp-shadow.${m[2]}` : tplPath + '.cphp-shadow.c';
}

// ---- libs.json: cphp('lib/file.php') -> real file ----
const libsCache = new Map();   // libs.json path -> { mtime, libs }
function libsMap(vendors) {
  const libs = {};
  const dirs = new Set(dbFiles().map((g) => fwd(g).replace(/\/cphp\/.*$/, '/cphp')));
  if (ccdir) dirs.add(fwd(ccdir) + '/cphp');
  for (const d of dirs) {
    const f = d + '/libs.json';
    try {
      const m = fs.statSync(f).mtimeMs;
      let e = libsCache.get(f);
      if (!e || e.mtime !== m) { const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        e = { mtime: m, libs: j.libs || {}, vendors: j.vendors || [] }; libsCache.set(f, e); }
      if (vendors) for (const v of e.vendors) vendors.add(v);
      for (const k of Object.keys(e.libs)) if (!(k in libs)) libs[k] = e.libs[k];
    } catch (_) { /* absent or unreadable */ }
  }
  return libs;
}
// Warn once per (libs.json, version) when the build was generated by another c.php version.
const warnedVersions = new Set();
function checkVersions() {
  if (!opts.version) return;
  const dirs = new Set(dbFiles().map((g) => fwd(g).replace(/\/cphp\/.*$/, '/cphp')));
  if (ccdir) dirs.add(fwd(ccdir) + '/cphp');
  for (const d of dirs) {
    let v;
    try { v = JSON.parse(fs.readFileSync(d + '/libs.json', 'utf8')).cphpVersion; } catch (_) { continue; }
    const key = d + '@' + v;
    if (!v || v === opts.version || warnedVersions.has(key)) continue;
    warnedVersions.add(key);
    write(process.stdout, { jsonrpc: '2.0', method: 'window/showMessage', params: { type: 2,
      message: `c.php: the build in ${d} was generated by c.php ${v}, but the editor extension is ${opts.version}. Update one of them.` } });
  }
}
// Location for a cphp('lib/file.php') string literal under `pos`, or null.
function cphpDefinition(text, pos) {
  const line = text.split(/\r\n|\r|\n/)[pos.line];
  if (line === undefined) return null;
  const re = /\bcphp\(\s*(['"])([^'"]+)\1/g;
  for (let m; (m = re.exec(line));) {
    const start = m.index + m[0].length - m[2].length - 1;
    if (pos.character < start || pos.character > start + m[2].length + 1) continue;
    const i = m[2].replace(/\\/g, '/').indexOf('/');
    const dir = i > 0 && libsMap()[m[2].slice(0, i)];
    if (!dir) return null;
    const file = path.resolve(dir, m[2].slice(i + 1));
    const root = path.resolve(dir);
    if (!fs.existsSync(file) || !cmpPath(file).startsWith(cmpPath(root).replace(/\/?$/, '/'))) return null;
    const z = { line: 0, character: 0 };
    return { uri: pathToFileURL(file).href, range: { start: z, end: z } };
  }
  return null;
}

// ---- shadow ----
function shadowOf(text, uri, lang = 'c') {
  const r = spawnSync(opts.php, ['-d', 'short_open_tag=0', opts.shadow, '-', '--lang', lang], { input: text, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    log(`shadow failed for ${uri}: ${(r.stderr || r.error || '').toString().trim()}`);
    return text;
  }
  return r.stdout;
}

// ---- URI translation ----
const toServer = new Map();   // norm(template uri) -> sibling uri
const toClient = new Map();   // norm(sibling uri)  -> template uri
function deepMap(v, map) {
  if (typeof v === 'string') return v.startsWith('file:') ? map.get(norm(v)) ?? v : v;
  if (Array.isArray(v)) return v.map((x) => deepMap(x, map));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k.startsWith('file:') ? map.get(norm(k)) ?? k : k] = deepMap(v[k], map);
    return o;
  }
  return v;
}
function openTemplate(uri) {
  if (toServer.has(norm(uri))) return toServer.get(norm(uri));
  const tpl = fileURLToPath(uri);
  const sib = siblingFor(tpl) || virtualSibling(tpl);
  const sibUri = pathToFileURL(sib).href;
  toServer.set(norm(uri), sibUri);
  toClient.set(norm(sibUri), uri);
  return sibUri;
}

// ---- generated file -> template ----
// clangd answers definition/references with locations in the generated `foo.c` (for files the
// client has not opened as templates). The expander's `foo.c.map` ([generated line, template line]
// pairs, 1-based) turns those back into template locations.
const genMaps = new Map();   // generated path -> { mtime, map } (map null: no map file)
function genMapOf(file) {
  let m;
  try { m = fs.statSync(file + '.map').mtimeMs; } catch (_) { return null; }
  let e = genMaps.get(file);
  if (!e || e.mtime !== m) {
    try { e = { mtime: m, map: JSON.parse(fs.readFileSync(file + '.map', 'utf8')) }; } catch (_) { e = { mtime: m, map: null }; }
    genMaps.set(file, e);
  }
  return e.map && Array.isArray(e.map.lines) && e.map.template ? e.map : null;
}
const readLines = (f) => { try { return splitLines(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
// Template position for a generated one. Columns survive up to the first divergence between the
// two lines (an expanded `<?= ?>` starts there); a range end that falls inside the expansion goes
// to the end of that echo tag.
function genToTemplate(map, gen, tpl, pos, isEnd) {
  const g = pos.line;
  let hit = null;
  for (const [gl, tl] of map.lines) if (gl - 1 <= g) hit = [gl - 1, tl - 1]; else break;
  const tl = Math.max(0, Math.min(hit ? hit[1] + (g - hit[0]) : g, tpl.length - 1));
  const gt = gen[g] || '', tt = tpl[tl] || '';
  let pre = 0;
  while (pre < gt.length && pre < tt.length && gt[pre] === tt[pre]) pre++;
  let suf = 0;
  while (suf < gt.length - pre && suf < tt.length - pre && gt[gt.length - 1 - suf] === tt[tt.length - 1 - suf]) suf++;
  let ch;
  if (pos.character <= pre) ch = pos.character;
  else if (gt.length - pos.character <= suf) ch = tt.length - (gt.length - pos.character);
  else if (isEnd) { const i = tt.indexOf('?>', pre); ch = i >= 0 ? i + 2 : pre; }
  else ch = pre;
  return { line: tl, character: Math.max(0, Math.min(ch, tt.length)) };
}
// Template -> generated: a name built with `<?= ?>` (`op_<?= $n ?>`) does not exist in the template
// and clangd only sees a placeholder, so definition there lists the names the expander produced.
function echoNameDefinitions(tplPath, text, pos) {
  const line = splitLines(text)[pos.line];
  if (line === undefined) return null;
  const re = /(?:\w|<\?=.*?\?>)+/g;
  let m;
  while ((m = re.exec(line))) {
    if (pos.character < m.index || pos.character > m.index + m[0].length) continue;
    if (!/<\?=/.test(m[0]) || !/\w/.test(m[0].replace(/<\?=.*?\?>/g, ''))) return null;
    break;
  }
  if (!m) return null;
  const gp = siblingFor(tplPath);
  const map = gp && genMapOf(gp);
  const gen = map && readLines(gp);
  if (!gen) return null;
  const genUri = pathToFileURL(gp).href, out = [];
  map.lines.forEach(([gl, tl], i) => {
    const next = i + 1 < map.lines.length ? map.lines[i + 1][0] : gen.length + 1;
    const g = gl - 1 + (pos.line - (tl - 1));   // generated line of this run that maps to the template line
    if (pos.line < tl - 1 || g >= next - 1 || g >= gen.length) return;
    const w = /^\w+/.exec(gen[g].slice(m.index));
    if (w) out.push({ uri: genUri, range: { start: { line: g, character: m.index }, end: { line: g, character: m.index + w[0].length } } });
  });
  return out.length ? out : null;
}
function locToTemplate(uri, range) {
  if (toClient.has(norm(uri))) return null;   // opened template: shadow positions are already template positions
  let file;
  try { file = fileURLToPath(uri); } catch (_) { return null; }
  const map = genMapOf(file);
  if (!map || !fs.existsSync(map.template)) return null;
  const tplUri = pathToFileURL(map.template).href;
  const gen = readLines(file), tpl = docText.has(tplUri) ? splitLines(docText.get(tplUri)) : readLines(map.template);
  if (!gen || !tpl) return null;
  const start = genToTemplate(map, gen, tpl, range.start, false);
  let end = genToTemplate(map, gen, tpl, range.end, true);
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) end = start;
  return { uri: tplUri, range: { start, end } };
}
function remapLocations(v) {
  if (Array.isArray(v)) {
    const seen = new Set();
    return v.map(remapLocations).filter((x) => {
      if (!x || typeof x !== 'object' || !x.uri || !x.range) return true;
      const k = x.uri + JSON.stringify(x.range);
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }
  if (!v || typeof v !== 'object') return v;
  if (typeof v.uri === 'string' && v.range && v.range.start) {
    const t = locToTemplate(v.uri, v.range);
    if (t) return Object.assign({}, v, t);
  }
  if (typeof v.targetUri === 'string' && v.targetRange) {
    const r = locToTemplate(v.targetUri, v.targetRange);
    const sel = r && locToTemplate(v.targetUri, v.targetSelectionRange || v.targetRange);
    if (r && sel) return Object.assign({}, v, { targetUri: r.uri, targetRange: r.range, targetSelectionRange: sel.range });
  }
  const o = {};
  for (const k of Object.keys(v)) o[k] = remapLocations(v[k]);
  return o;
}

// ---- LSP framing ----
function reader(stream, onMsg) {
  let buf = Buffer.alloc(0);
  stream.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      const m = /Content-Length: *(\d+)/i.exec(buf.slice(0, i).toString('ascii'));
      if (!m) { buf = buf.slice(i + 4); continue; }
      const len = +m[1];
      if (buf.length < i + 4 + len) return;
      const body = buf.slice(i + 4, i + 4 + len).toString('utf8');
      buf = buf.slice(i + 4 + len);
      try { onMsg(JSON.parse(body)); } catch (e) { log('bad message: ' + e.message); }
    }
  });
}
function write(stream, msg) {
  const s = JSON.stringify(msg);
  stream.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`);
}

// ---- main ----
const clangd = spawn(opts.clangd, opts.rest, { stdio: ['pipe', 'pipe', 'inherit'] });
clangd.on('error', (e) => { log('cannot start clangd: ' + e.message); process.exit(1); });
clangd.on('exit', (c) => { if (phpls) phpls.kill(); process.exit(c ?? 0); });
process.stdin.on('end', () => { clangd.kill(); if (phpls) phpls.kill(); });

// Optional second server for the PHP shadow. Its server-to-client request ids are prefixed
// so client replies can be routed back; its own requests (initialize, shutdown) use PHPLS_ID.
const PFX = 'php:';
let phpls = null, phplsReady = false;
let phplsInit = null;   // timeout handle for the phpls initialize reply
let phplsResult;        // undefined until that reply arrives (null: failed)
if (opts.phpls) {
  phpls = spawn(opts.phpls, opts.phplsArgs, { stdio: ['pipe', 'pipe', 'inherit'] });
  const gone = () => { phpls = null; phplsReady = false; if (phplsResult === undefined) { phplsResult = null; finishInit(null); } };
  phpls.on('error', (e) => { log('cannot start PHP language server: ' + e.message);
    write(process.stdout, { jsonrpc: '2.0', method: 'window/showMessage', params: { type: 2,
      message: `c.php: PHP language server '${opts.phpls}' could not be started (${e.code || e.message}), so PHP regions have no hover, completion or definition. Install it (npm i -g intelephense) or set cphp.phpServer.` } });
    gone(); });
  phpls.on('exit', gone);
  phpls.stdin.on('error', () => {});
}
const phpOn = () => phpls && phplsReady;

let initId = null, initMsg = null;
const docText = new Map();   // template uri -> latest text (for cphp('...') lookups)
const docMask = new Map();   // template uri -> { c: lines, php: lines } shadows, for region routing
const diags = new Map();     // template uri -> { c: [], php: [] }
const symPending = new Map();   // client request id -> { c, php, timer } while merging documentSymbol replies
const SYM = 'cphp-sym:';
const docShadow = new Map();  // template uri -> C shadow lines, to drop clangd tokens on placeholders
const hoverPending = new Map(); // client request id -> { uri, pos } for clangd hover requests
const tokPending = new Map();   // client request id -> { c, php, timer } while merging semanticTokens/full replies
const TOK = 'cphp-tok:';
let tokLegend = null;           // { legend, remap }: merged legend and PHP index remap, set when the PHP server offers tokens

function publishMerged(uri) {
  const d = diags.get(uri) || { c: [], php: [] };
  write(process.stdout, { jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: d.c.concat(d.php) } });
}

// Region of a position: the character at it decides, else the one before it (cursor after an
// identifier). A PHP shadow character that is not blank means PHP; a C shadow one means C.
function regionAt(uri, pos) {
  const m = docMask.get(uri);
  if (!m) return 'c';
  const at = (lines, ch) => { const l = lines[pos.line]; return l !== undefined && ch >= 0 && ch < l.length && !/\s/.test(l[ch]); };
  for (const ch of [pos.character, pos.character - 1]) {
    if (at(m.php, ch)) return 'php';
    if (at(m.c, ch)) return 'c';
  }
  return 'c';
}
function replySymbols(id) {
  const e = symPending.get(id);
  if (!e || e.c === undefined || e.php === undefined) return;
  clearTimeout(e.timer);
  symPending.delete(id);
  const c = Array.isArray(e.c.result) ? e.c.result : [], php = Array.isArray(e.php) ? e.php : [];
  // DocumentSymbol[] and SymbolInformation[] cannot be mixed; keep clangd's if the shapes differ.
  const flat = (a) => a[0].location !== undefined;
  const merged = !php.length || !c.length || flat(c) === flat(php) ? c.concat(php) : c;
  const line = (x) => (x.range || x.location.range).start.line;
  write(process.stdout, Object.assign({}, e.c, { result: merged.sort((a, b) => line(a) - line(b)) }));
}
// ---- semantic tokens ----
// Legends differ per server, so the client gets clangd's legend plus whatever PHP types/modifiers
// it lacks; PHP indices are remapped. The shadows keep the template's layout, so both servers'
// positions are already template positions and merging is decode, remap, sort, re-encode.
function mergeLegends(cl, pl) {
  const types = (cl.tokenTypes || []).slice(), mods = (cl.tokenModifiers || []).slice();
  const add = (list, v) => { let i = list.indexOf(v); if (i < 0) { i = list.length; list.push(v); } return i; };
  const tMap = (pl.tokenTypes || []).map((t) => add(types, t));
  const mMap = (pl.tokenModifiers || []).map((m) => add(mods, m));
  const mod = (bits) => { let out = 0; mMap.forEach((to, from) => { if (bits & (1 << from)) out |= 1 << to; }); return out >>> 0; };
  return { legend: { tokenTypes: types, tokenModifiers: mods }, remap: (t, m) => [tMap[t] !== undefined ? tMap[t] : t, mod(m)] };
}
function decodeTokens(data, remap) {
  const out = [];
  let line = 0, ch = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    line += data[i];
    ch = data[i] ? data[i + 1] : ch + data[i + 1];
    const [t, m] = remap ? remap(data[i + 3], data[i + 4]) : [data[i + 3], data[i + 4]];
    out.push([line, ch, data[i + 2], t, m]);
  }
  return out;
}
function encodeTokens(toks) {
  toks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const data = [];
  let pl = 0, pc = 0;
  for (const [l, c, len, t, m] of toks) {
    data.push(l - pl, l === pl ? c - pc : c, len, t, m);
    pl = l; pc = c;
  }
  return data;
}
// A placeholder (`+`, `_`) stands in for a `<?= ?>` echo in the C shadow; clangd's semantic tokens on
// it would colour template characters that are not C, so drop tokens whose shadow text differs.
function dropPlaceholderTokens(uri, toks) {
  const sh = docShadow.get(uri), tpl = splitLines(docText.get(uri) || '');
  if (!sh) return toks;
  return toks.filter(([l, c, len]) => l >= tpl.length || (tpl[l] || '').substr(c, len) === (sh[l] || '').substr(c, len));
}
// clangd names an echo-built identifier after its placeholder (`op_______`); show the template
// spelling (`op_<?= $name ?>`) in hover text instead. Shadows keep widths, so columns line up.
function templateHover(result, uri, pos) {
  const sh = (docShadow.get(uri) || [])[pos.line], tpl = splitLines(docText.get(uri) || '')[pos.line];
  if (!result || !result.contents || sh === undefined || tpl === undefined) return result;
  const isId = (ch) => /\w/.test(sh[ch] || '');
  let at = pos.character;
  if (!isId(at) && isId(at - 1)) at--;
  if (!isId(at)) return result;
  let s = at, e = at + 1;
  while (s > 0 && isId(s - 1)) s--;
  while (isId(e)) e++;
  const word = sh.slice(s, e), orig = tpl.slice(s, e);
  if (word === orig) return result;
  const fix = (t) => t.split(word).join(orig);
  const c = result.contents;
  const contents = typeof c === 'string' ? fix(c)
    : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? fix(x) : Object.assign({}, x, { value: fix(x.value) })))
      : Object.assign({}, c, { value: fix(c.value) });
  return Object.assign({}, result, { contents });
}
function replyTokens(id) {
  const e = tokPending.get(id);
  if (!e || e.c === undefined || e.php === undefined) return;
  clearTimeout(e.timer);
  tokPending.delete(id);
  const cd = e.c.result && e.c.result.data, pd = e.php && e.php.data;
  if (!cd && !pd) { write(process.stdout, e.c.result ? e.c : Object.assign({}, e.c, { result: e.php || null })); return; }
  const toks = dropPlaceholderTokens(e.uri, decodeTokens(cd || [])).concat(tokLegend ? decodeTokens(pd || [], tokLegend.remap) : []);
  write(process.stdout, Object.assign({}, e.c, { error: undefined, result: { data: encodeTokens(toks) } }));
}
const splitLines = (t) => t.split(/\r\n|\r|\n/);
const POSITIONAL = new Set(['hover', 'completion', 'definition', 'declaration', 'typeDefinition', 'implementation',
  'references', 'signatureHelp', 'documentHighlight', 'rename', 'prepareRename']);

function syncDoc(tplUri, td, text) {
  const cSh = shadowOf(text, tplUri, 'c');
  const out = { c: cSh };
  docShadow.set(tplUri, splitLines(cSh));
  if (phpOn()) {
    const pSh = shadowOf(text, tplUri, 'php');
    docMask.set(tplUri, { c: splitLines(cSh), php: splitLines(pSh) });
    out.php = pSh;
  }
  return out;
}

function fromClient(msg) {
  if (msg.method === 'initialize') {
    initId = msg.id;
    if (phpls) {
      initMsg = msg;
      const pi = JSON.parse(JSON.stringify(msg));
      pi.id = 'cphp-init';
      // Shared PHP libs and Composer vendor dirs become extra workspace folders so the PHP
      // server indexes them (read once, here; restart to pick up later libs.json changes).
      const vendors = new Set(), libs = libsMap(vendors);
      const extra = [...new Set([...Object.values(libs), ...vendors])].filter((d) => fs.existsSync(d));
      if (extra.length) {
        const have = pi.params.workspaceFolders || [];
        pi.params.workspaceFolders = have.concat(extra.map((d) => ({ uri: pathToFileURL(d).href, name: path.basename(d) })));
      }
      write(phpls.stdin, pi);
      phplsInit = setTimeout(() => { phplsResult = null; finishInit(null); }, 15000);
    }
  }
  // client reply to a phpls-originated request
  if (msg.method === undefined && typeof msg.id === 'string' && msg.id.startsWith(PFX)) {
    if (phpls) write(phpls.stdin, Object.assign({}, msg, { id: msg.id.slice(PFX.length) }));
    return;
  }
  if (msg.method === 'initialized') checkVersions();
  if (msg.method === '$/cancelRequest' && phpOn()) write(phpls.stdin, msg);
  if (msg.method === 'shutdown' && phpOn()) write(phpls.stdin, { jsonrpc: '2.0', id: 'cphp-shutdown', method: 'shutdown', params: null });
  if (msg.method === 'exit' && phpls) write(phpls.stdin, msg);
  if (msg.method && !msg.method.startsWith('textDocument/') && msg.method !== '$/cancelRequest' && msg.method !== 'initialize'
      && msg.method !== 'shutdown' && msg.method !== 'exit' && phpOn()) {
    write(phpls.stdin, msg);   // initialized, workspace/*, $/...: both servers want them
  }
  const td = msg.params && msg.params.textDocument;
  if (td && typeof td.uri === 'string' && isTemplate(td.uri)) {
    const tplUri = td.uri;
    // The client may still have requests in flight when it closes a document; clangd would answer
    // them with a "non-added document" error that the client logs as a failed request.
    if (msg.id !== undefined && msg.method && !docText.has(tplUri)) {
      return write(process.stdout, { jsonrpc: '2.0', id: msg.id, result: null });
    }
    const sibUri = openTemplate(tplUri);
    if (msg.method === 'textDocument/definition' && msg.id !== undefined) {
      const loc = cphpDefinition(docText.get(tplUri) || '', msg.params.position);
      if (loc) return write(process.stdout, { jsonrpc: '2.0', id: msg.id, result: [loc] });
      const echoed = echoNameDefinitions(fileURLToPath(tplUri), docText.get(tplUri) || '', msg.params.position);
      if (echoed) return write(process.stdout, { jsonrpc: '2.0', id: msg.id, result: echoed });
    }
    const kind = msg.method && msg.method.slice('textDocument/'.length);
    if (phpOn() && msg.id !== undefined && kind === 'documentSymbol') {
      const e = { c: undefined, php: undefined, timer: null };
      e.timer = setTimeout(() => { if (e.php === undefined) e.php = []; replySymbols(msg.id); }, 5000);
      symPending.set(msg.id, e);
      write(phpls.stdin, { jsonrpc: '2.0', id: SYM + msg.id, method: msg.method, params: { textDocument: { uri: tplUri } } });
    }
    if (msg.id !== undefined && kind === 'semanticTokens/full') {
      const e = { c: undefined, php: null, timer: null, uri: tplUri };
      if (phpOn() && tokLegend) {
        e.php = undefined;
        e.timer = setTimeout(() => { if (e.php === undefined) e.php = null; replyTokens(msg.id); }, 5000);
        write(phpls.stdin, { jsonrpc: '2.0', id: TOK + msg.id, method: msg.method, params: { textDocument: { uri: tplUri } } });
      }
      tokPending.set(msg.id, e);
    }
    if (msg.id !== undefined && kind === 'hover' && msg.params.position) hoverPending.set(msg.id, { uri: tplUri, pos: msg.params.position });
    if (phpOn() && msg.id !== undefined && POSITIONAL.has(kind) && msg.params.position
        && regionAt(tplUri, msg.params.position) === 'php') {
      return write(phpls.stdin, msg);   // template URI is the PHP server's URI too
    }
    if (msg.method === 'textDocument/didClose') {
      docText.delete(tplUri); docMask.delete(tplUri); docShadow.delete(tplUri); diags.delete(tplUri);
      if (phpOn()) write(phpls.stdin, { jsonrpc: '2.0', method: msg.method, params: { textDocument: { uri: tplUri } } });
    }
    if (msg.method === 'textDocument/didOpen') {
      docText.set(tplUri, td.text);
      const sh = syncDoc(tplUri, td, td.text);
      if (phpOn()) write(phpls.stdin, { jsonrpc: '2.0', method: msg.method, params: { textDocument: { uri: tplUri, languageId: 'php', version: td.version, text: sh.php } } });
      td.languageId = 'c';
      td.text = sh.c;
    } else if (msg.method === 'textDocument/didChange' && msg.params.contentChanges.length) {
      const last = msg.params.contentChanges[msg.params.contentChanges.length - 1];
      docText.set(tplUri, last.text);
      const sh = syncDoc(tplUri, td, last.text);
      if (phpOn()) write(phpls.stdin, { jsonrpc: '2.0', method: msg.method, params: { textDocument: { uri: tplUri, version: td.version }, contentChanges: [{ text: sh.php }] } });
      msg.params.contentChanges = [{ text: sh.c }];   // full sync is advertised to the client
    } else if (msg.method === 'textDocument/didSave' && phpOn()) {
      write(phpls.stdin, { jsonrpc: '2.0', method: msg.method, params: { textDocument: { uri: tplUri } } });
    }
    msg.params.textDocument = Object.assign({}, td, { uri: sibUri });
  }
  write(clangd.stdin, deepMap(msg, toServer));
}

// executeCommandProvider: the client registers clangd's command ids (clangd.applyFix, ...) globally,
// so a second client (another workspace folder) or another clangd extension fails to initialize.
const DROP = ['documentFormattingProvider', 'documentRangeFormattingProvider', 'documentOnTypeFormattingProvider', 'executeCommandProvider'];
let clangdInit = null;
function finishInit(phpResult) {
  if (!clangdInit) return;
  clearTimeout(phplsInit);
  const msg = clangdInit;
  clangdInit = null;
  const c = msg.result.capabilities;
  if (phpResult && phpResult.capabilities) {
    phplsReady = true;
    const pc = phpResult.capabilities;
    const union = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
    if (pc.completionProvider) {
      c.completionProvider = Object.assign({}, c.completionProvider, { triggerCharacters: union(c.completionProvider && c.completionProvider.triggerCharacters, pc.completionProvider.triggerCharacters) });
    }
    if (pc.signatureHelpProvider) {
      c.signatureHelpProvider = Object.assign({}, c.signatureHelpProvider, {
        triggerCharacters: union(c.signatureHelpProvider && c.signatureHelpProvider.triggerCharacters, pc.signatureHelpProvider.triggerCharacters),
      });
    }
    for (const k of ['hoverProvider', 'definitionProvider', 'referencesProvider', 'renameProvider', 'documentHighlightProvider', 'implementationProvider', 'typeDefinitionProvider', 'declarationProvider']) {
      if (!c[k] && pc[k]) c[k] = pc[k];
    }
    const pt = pc.semanticTokensProvider;
    if (pt && pt.legend && (pt.full || pt.full === undefined)) {
      const m = mergeLegends((c.semanticTokensProvider && c.semanticTokensProvider.legend) || {}, pt.legend);
      tokLegend = m;
      c.semanticTokensProvider = { legend: m.legend, full: true, range: false };
    }
  } else if (opts.phpls) {
    log('PHP language server did not initialize; PHP features disabled');
  }
  if (!tokLegend && c.semanticTokensProvider && c.semanticTokensProvider.legend) {
    // tokens are filtered here, so only full requests (no delta/range) are offered
    c.semanticTokensProvider = { legend: c.semanticTokensProvider.legend, full: true, range: false };
  }
  c.textDocumentSync = { openClose: true, change: 1, save: { includeText: false } };
  for (const k of DROP) delete c[k];   // formatting is unsafe on the shadow; commands would collide across clients
  write(process.stdout, msg);
}

function fromServer(msg) {
  if (msg.id !== undefined && hoverPending.has(msg.id) && msg.method === undefined) {
    const h = hoverPending.get(msg.id);
    hoverPending.delete(msg.id);
    if (msg.result) msg = Object.assign({}, msg, { result: templateHover(msg.result, h.uri, h.pos) });
  }
  if (msg.id !== undefined && tokPending.has(msg.id) && msg.method === undefined) {
    tokPending.get(msg.id).c = deepMap(msg, toClient);
    return replyTokens(msg.id);
  }
  if (msg.id !== undefined && symPending.has(msg.id) && msg.method === undefined) {
    symPending.get(msg.id).c = deepMap(msg, toClient);
    return replySymbols(msg.id);
  }
  if (msg.id !== undefined && msg.id === initId && msg.result && msg.result.capabilities) {
    initId = null;
    if (!phpls) { clangdInit = msg; return finishInit(null); }
    clangdInit = msg;
    if (phplsResult !== undefined) finishInit(phplsResult);
    return;
  }
  if (msg.method === 'textDocument/publishDiagnostics') {
    const m = deepMap(msg, toClient);
    const uri = m.params.uri;
    if (isTemplate(uri)) {
      const d = diags.get(uri) || { c: [], php: [] };
      d.c = m.params.diagnostics;
      diags.set(uri, d);
      return publishMerged(uri);
    }
  }
  if (msg.id !== undefined && msg.method === undefined && msg.result) msg = Object.assign({}, msg, { result: remapLocations(msg.result) });
  write(process.stdout, deepMap(msg, toClient));
}

function fromPhpls(msg) {
  if (msg.id === 'cphp-init') {
    phplsResult = msg.result || null;
    if (clangdInit) finishInit(phplsResult);
    return;
  }
  if (msg.id === 'cphp-shutdown') return;
  if (typeof msg.id === 'string' && msg.id.startsWith(SYM) && msg.method === undefined) {
    const raw = msg.id.slice(SYM.length);
    const id = [...symPending.keys()].find((k) => String(k) === raw);
    if (id !== undefined) { symPending.get(id).php = msg.result || []; replySymbols(id); }
    return;
  }
  if (typeof msg.id === 'string' && msg.id.startsWith(TOK) && msg.method === undefined) {
    const raw = msg.id.slice(TOK.length);
    const id = [...tokPending.keys()].find((k) => String(k) === raw);
    if (id !== undefined) { tokPending.get(id).php = msg.result || null; replyTokens(id); }
    return;
  }
  if (msg.method === 'textDocument/publishDiagnostics' && isTemplate(msg.params.uri)) {
    const d = diags.get(msg.params.uri) || { c: [], php: [] };
    d.php = msg.params.diagnostics;
    diags.set(msg.params.uri, d);
    return publishMerged(msg.params.uri);
  }
  if (msg.method && msg.id !== undefined) msg.id = PFX + msg.id;   // server-to-client request
  write(process.stdout, msg);
}

reader(process.stdin, fromClient);
reader(clangd.stdout, fromServer);
if (phpls) reader(phpls.stdout, fromPhpls);
