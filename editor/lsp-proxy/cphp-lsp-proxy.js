#!/usr/bin/env node
'use strict';
/*
 * cphp LSP proxy (C side): sits between an editor and clangd.
 *
 *   cphp-lsp-proxy.js [--clangd PATH] [--php PATH] [--shadow PATH] [clangd args...]
 *
 * For `*.c.php` / `*.h.php` documents the proxy sends clangd the C shadow
 * (bin/cphp-shadow.php) instead of the template, opened under the generated
 * sibling URI (`<build>/.../cphp/<name>.c`, found via compile_commands.json) so
 * clangd uses the real compile flags. Shadows keep the template's line/column
 * layout, so positions pass through unchanged; only URIs are translated, both
 * ways. Everything else is forwarded untouched. No npm dependencies.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const WIN = process.platform === 'win32';
const opts = { clangd: 'clangd', php: 'php', shadow: path.join(__dirname, '..', '..', 'bin', 'cphp-shadow.php'), rest: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--clangd') opts.clangd = process.argv[++i];
  else if (a === '--php') opts.php = process.argv[++i];
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

// ---- shadow ----
function shadowOf(text, uri) {
  const r = spawnSync(opts.php, ['-d', 'short_open_tag=0', opts.shadow, '-', '--lang', 'c'], { input: text, encoding: 'utf8', maxBuffer: 1 << 28 });
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
clangd.on('exit', (c) => process.exit(c ?? 0));
process.stdin.on('end', () => clangd.kill());

let initId = null;

function fromClient(msg) {
  if (msg.method === 'initialize') initId = msg.id;
  const td = msg.params && msg.params.textDocument;
  if (td && typeof td.uri === 'string' && isTemplate(td.uri)) {
    const tplUri = td.uri;
    const sibUri = openTemplate(tplUri);
    if (msg.method === 'textDocument/didOpen') {
      td.languageId = 'c';
      td.text = shadowOf(td.text, tplUri);
    } else if (msg.method === 'textDocument/didChange' && msg.params.contentChanges.length) {
      const last = msg.params.contentChanges[msg.params.contentChanges.length - 1];
      msg.params.contentChanges = [{ text: shadowOf(last.text, tplUri) }];   // full sync is advertised to the client
    }
    msg.params.textDocument = Object.assign({}, td, { uri: sibUri });
  }
  write(clangd.stdin, deepMap(msg, toServer));
}

const DROP = ['documentFormattingProvider', 'documentRangeFormattingProvider', 'documentOnTypeFormattingProvider'];
function fromServer(msg) {
  if (msg.id !== undefined && msg.id === initId && msg.result && msg.result.capabilities) {
    const c = msg.result.capabilities;
    c.textDocumentSync = { openClose: true, change: 1, save: { includeText: false } };
    for (const k of DROP) delete c[k];   // formatting is unsafe on the shadow
    initId = null;
  }
  write(process.stdout, deepMap(msg, toClient));
}

reader(process.stdin, fromClient);
reader(clangd.stdout, fromServer);
