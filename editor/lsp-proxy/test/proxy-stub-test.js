// Proxy behaviour that needs no real language server: cphpVersion warning, documentSymbol and
// semantic token merging, with stub servers standing in for clangd and the PHP server. Needs node and php.
// Run: node editor/lsp-proxy/test/proxy-stub-test.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

if (spawnSync('php', ['--version']).error) { console.log('skip stub proxy test: php not found'); process.exit(0); }
const stub = path.join(__dirname, 'stub-server.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cphp-stub-'));
fs.mkdirSync(path.join(dir, 'build/cphp'), { recursive: true });
fs.writeFileSync(path.join(dir, 'build/cphp/libs.json'), JSON.stringify({ cphpVersion: '0.0.1', libs: {}, vendors: [] }));
const tpl = path.join(dir, 'a.c.php');
fs.writeFileSync(tpl, '<?php $a = 1; ?>\nint x;\nint f(void);\n');
const uri = pathToFileURL(tpl).href;

const p = spawn('node', [path.join(__dirname, '../cphp-lsp-proxy.js'), '--stdio', '--cphp-version', '9.9.9',
  '--clangd', process.execPath, '--phpls', process.execPath, '--phpls-arg', stub, '--phpls-arg', 'php',
  stub, 'c', '--compile-commands-dir=' + path.join(dir, 'build')], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = Buffer.alloc(0), id = 0;
const pend = new Map(), messages = [];
p.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
    const len = +/Content-Length: (\d+)/.exec(buf.slice(0, i).toString())[1];
    if (buf.length < i + 4 + len) return;
    const m = JSON.parse(buf.slice(i + 4, i + 4 + len).toString()); buf = buf.slice(i + 4 + len);
    if (m.id !== undefined && pend.has(m.id)) pend.get(m.id)(m); else messages.push(m);
  }
});
const send = (o) => { const s = JSON.stringify(o); p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); };
const req = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); send({ jsonrpc: '2.0', id: i, method, params }); });
const note = (method, params) => send({ jsonrpc: '2.0', method, params });
const until = async (fn, ms = 5000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)); } };
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

(async () => {
  const init = await req('initialize', { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {} });
  note('initialized', {});
  await check('version mismatch in libs.json produces a warning', async () => {
    const m = await until(() => messages.find((x) => x.method === 'window/showMessage'));
    assert(/0\.0\.1/.test(m.params.message) && /9\.9\.9/.test(m.params.message), m.params.message);
    assert.strictEqual(m.params.type, 2);
  });
  note('textDocument/didOpen', { textDocument: { uri, languageId: 'cphp', version: 1, text: fs.readFileSync(tpl, 'utf8') } });
  await check('documentSymbol merges both servers, sorted by line', async () => {
    const r = await req('textDocument/documentSymbol', { textDocument: { uri } });
    assert.deepStrictEqual(r.result.map((s) => s.name), ['php_fn_a', 'c_fn', 'php_fn_b']);
  });
  await check('semanticTokens/full merges tokens under a merged legend', async () => {
    const caps = init.result.capabilities.semanticTokensProvider;
    assert.deepStrictEqual(caps.legend, { tokenTypes: ['function', 'variable', 'class'], tokenModifiers: ['declaration', 'readonly'] });
    assert.strictEqual(caps.range, false);
    const r = await req('textDocument/semanticTokens/full', { textDocument: { uri } });
    assert.deepStrictEqual(r.result.data, [0, 6, 2, 1, 2, 0, 4, 3, 2, 0, 2, 4, 1, 0, 1]);
  });
  note('textDocument/didClose', { textDocument: { uri } });
  await req('shutdown', null);
  note('exit', null);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
