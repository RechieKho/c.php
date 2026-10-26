// End-to-end: proxy + real clangd on tests/example-project. Skips if cmake/clangd/php are missing.
// Run: node editor/lsp-proxy/test/proxy-test.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '../../..');
for (const t of ['cmake', 'clangd', 'php']) {
  if (spawnSync(t, ['--version']).error) { console.log(`skip proxy test: ${t} not found`); process.exit(0); }
}
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'cphp-proxy-'));
for (const args of [['-S', root, '-B', build, '-DCPHP_BUILD_EXAMPLES=ON'], ['--build', build]]) {
  const r = spawnSync('cmake', args, { encoding: 'utf8' });
  if (r.status !== 0) { console.log(r.stdout + r.stderr); process.exit(1); }
}
const tpl = path.join(root, 'tests/example-project/table.c.php');
const tplUri = pathToFileURL(tpl).href;
const src = fs.readFileSync(tpl, 'utf8');
const bad = src.replace('return a', 'return zz + a');   // line 4 (0-based)

const p = spawn('node', [path.join(__dirname, '../cphp-lsp-proxy.js'), '--stdio', '--compile-commands-dir=' + build, '--log=error'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = Buffer.alloc(0), id = 0;
const pend = new Map(), diags = [];
p.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
    const len = +/Content-Length: (\d+)/.exec(buf.slice(0, i).toString())[1];
    if (buf.length < i + 4 + len) return;
    const m = JSON.parse(buf.slice(i + 4, i + 4 + len).toString()); buf = buf.slice(i + 4 + len);
    if (m.id !== undefined && pend.has(m.id)) pend.get(m.id)(m);
    else if (m.method === 'textDocument/publishDiagnostics') diags.push(m.params);
    else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: null });
  }
});
function send(o) { const s = JSON.stringify(o); p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); }
const req = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); send({ jsonrpc: '2.0', id: i, method, params }); });
const note = (method, params) => send({ jsonrpc: '2.0', method, params });
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)); } };

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

(async () => {
  const init = await req('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} });
  note('initialized', {});
  await check('capabilities: full sync, no formatting', () => {
    const c = init.result.capabilities;
    assert.strictEqual(c.textDocumentSync.change, 1);
    assert(!c.documentFormattingProvider && !c.documentRangeFormattingProvider);
  });
  note('textDocument/didOpen', { textDocument: { uri: tplUri, languageId: 'cphp', version: 1, text: bad } });
  await check('diagnostic comes back on the template URI at template line', async () => {
    const d = await until(() => diags.find((x) => x.uri === tplUri && x.diagnostics.some((e) => /zz/.test(e.message))));
    assert.strictEqual(d.diagnostics.find((e) => /zz/.test(e.message)).range.start.line, 4);
  });
  await check('hover on template position', async () => {
    const h = await req('textDocument/hover', { textDocument: { uri: tplUri }, position: { line: 4, character: 5 } });
    assert(h.result && JSON.stringify(h.result).includes('int'));
  });
  await check('definition of a header symbol maps back to a real file', async () => {
    const d = await req('textDocument/definition', { textDocument: { uri: tplUri }, position: { line: 4, character: 5 } });
    assert(d.result && d.result.length >= 1 && d.result[0].uri.startsWith('file:'));
  });
  await check("definition on cphp('lib/file.php') uses libs.json", async () => {
    const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cphp-lib-'));
    fs.writeFileSync(path.join(libDir, 'macros.php'), '<?php\n');
    const lj = path.join(build, 'tests/example-project/cphp/libs.json');
    fs.writeFileSync(lj, JSON.stringify({ cphpVersion: 'x', libs: { demo: libDir.replace(/\\/g, '/') } }));
    const text = "<?php require cphp('demo/macros.php'); ?>\n";
    const u = pathToFileURL(path.join(root, 'tests/example-project/other.c.php')).href;
    note('textDocument/didOpen', { textDocument: { uri: u, languageId: 'cphp', version: 1, text } });
    const col = text.indexOf('demo') + 1;
    const d = await req('textDocument/definition', { textDocument: { uri: u }, position: { line: 0, character: col } });
    assert.strictEqual(d.result[0].uri, pathToFileURL(path.join(libDir, 'macros.php')).href);
    const none = await req('textDocument/definition', { textDocument: { uri: u }, position: { line: 0, character: 2 } });
    assert(!none.result || !none.result.some((l) => l.uri.endsWith('macros.php')));
    note('textDocument/didClose', { textDocument: { uri: u } });
    fs.rmSync(libDir, { recursive: true, force: true });
  });
  diags.length = 0;
  note('textDocument/didChange', { textDocument: { uri: tplUri, version: 2 }, contentChanges: [{ text: src }] });
  await check('didChange: error disappears', async () => {
    const d = await until(() => diags.find((x) => x.uri === tplUri));
    assert(!d.diagnostics.some((e) => /zz/.test(e.message)));
  });
  note('textDocument/didClose', { textDocument: { uri: tplUri } });
  await req('shutdown', null);
  note('exit', null);
  fs.rmSync(build, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
