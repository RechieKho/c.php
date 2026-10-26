// End-to-end: proxy + clangd + a PHP language server (Intelephense by default).
// Skips unless clangd, php and the server are available.
// Run: CPHP_TEST_PHPLS=/path/to/intelephense node editor/lsp-proxy/test/proxy-php-test.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

const phpls = process.env.CPHP_TEST_PHPLS || 'intelephense';
for (const t of ['clangd', 'php']) {
  if (spawnSync(t, ['--version']).error) { console.log(`skip php proxy test: ${t} not found`); process.exit(0); }
}
if (spawnSync(phpls, ['--help']).error) { console.log(`skip php proxy test: ${phpls} not found (set CPHP_TEST_PHPLS)`); process.exit(0); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cphp-phpls-'));
const tpl = path.join(dir, 'gen.c.php');
const uri = pathToFileURL(tpl).href;
const lines = [
  '<?php $n = 3; $s = strlen("abc"); $k = cphp_lib_fn(); ?>',          // 0: valid PHP
  'int f(void) { return zz; }',                       // 1: C error (zz undeclared)
  '<?php $y = ; ?>',                                  // 2: PHP syntax error
  'int g(void) { return <?= $n ?>; }',                // 3
];
const lib = path.join(dir, 'mylib');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'fn.php'), '<?php\nfunction cphp_lib_fn(): int { return 1; }\n');
fs.mkdirSync(path.join(dir, 'build/cphp'), { recursive: true });
fs.writeFileSync(path.join(dir, 'build/cphp/libs.json'), JSON.stringify({ cphpVersion: 'x', libs: { demo: lib }, vendors: [] }));
const text = lines.join('\n') + '\n';
fs.writeFileSync(tpl, text);

const p = spawn('node', [path.join(__dirname, '../cphp-lsp-proxy.js'), '--stdio', '--compile-commands-dir=' + path.join(dir, 'build'), '--phpls', phpls, '--phpls-arg', '--stdio', '--log=error'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = Buffer.alloc(0), id = 0;
const pend = new Map(), diags = [];
p.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
    const len = +/Content-Length: (\d+)/.exec(buf.slice(0, i).toString())[1];
    if (buf.length < i + 4 + len) return;
    const m = JSON.parse(buf.slice(i + 4, i + 4 + len).toString()); buf = buf.slice(i + 4 + len);
    if (m.id !== undefined && !m.method && pend.has(m.id)) pend.get(m.id)(m);
    else if (m.method === 'textDocument/publishDiagnostics') diags.push(m.params);
    else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: m.method === 'workspace/configuration' ? (m.params.items || []).map(() => null) : null });
  }
});
function send(o) { const s = JSON.stringify(o); p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); }
const req = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); send({ jsonrpc: '2.0', id: i, method, params }); });
const note = (method, params) => send({ jsonrpc: '2.0', method, params });
const until = async (fn, ms = 30000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)); } };
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

(async () => {
  const init = await req('initialize', {
    processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {},
    initializationOptions: { storagePath: path.join(dir, '.ils'), globalStoragePath: path.join(dir, '.ilg'), clearCache: true },
  });
  note('initialized', {});
  await check('capabilities merged: PHP trigger characters present', () => {
    const t = init.result.capabilities.completionProvider.triggerCharacters;
    assert(t.includes('$') || t.includes('>'), JSON.stringify(t));
  });
  note('textDocument/didOpen', { textDocument: { uri, languageId: 'cphp', version: 1, text } });
  await check('diagnostics from both servers are merged on the template', async () => {
    const d = await until(() => {
      const all = diags.filter((x) => x.uri === uri);
      const last = all[all.length - 1];
      return last && last.diagnostics.some((e) => e.range.start.line === 1) && last.diagnostics.some((e) => e.range.start.line === 2) && last;
    });
    assert(d.diagnostics.some((e) => /zz/.test(e.message)), 'C error');
  });
  await check('hover in a PHP region goes to the PHP server', async () => {
    const h = await req('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: lines[0].indexOf('strlen') + 2 } });
    assert(h.result && /strlen/.test(JSON.stringify(h.result)), JSON.stringify(h.result));
  });
  await check('hover in C text still goes to clangd', async () => {
    const h = await req('textDocument/hover', { textDocument: { uri }, position: { line: 1, character: 4 } });
    assert(h.result && /int/.test(JSON.stringify(h.result)), JSON.stringify(h.result));
  });
  await check('definition of a function from a libs.json dir reaches the PHP server', async () => {
    const pos = { line: 0, character: lines[0].indexOf('cphp_lib_fn') + 3 };
    let d = null;
    for (let i = 0; i < 100 && !d; i++) {
      const r = await req('textDocument/definition', { textDocument: { uri }, position: pos });
      if (r.result && JSON.stringify(r.result).includes('fn.php')) d = r.result;
      else await new Promise((r2) => setTimeout(r2, 300));
    }
    assert(d, 'no definition in fn.php');
  });
  note('textDocument/didClose', { textDocument: { uri } });
  await req('shutdown', null);
  note('exit', null);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
