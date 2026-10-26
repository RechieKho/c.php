// Minimal LSP server for proxy tests: `node stub-server.js <c|php>`. Answers initialize,
// shutdown, textDocument/documentSymbol (one DocumentSymbol per name for its role) and
// semanticTokens/full (role-specific legend and tokens); ignores the rest.
const role = process.argv[2];
const sym = (name, line) => ({ name, kind: 12, range: { start: { line, character: 0 }, end: { line, character: 1 } }, selectionRange: { start: { line, character: 0 }, end: { line, character: 1 } } });
const symbols = role === 'c' ? [sym('c_fn', 2)] : [sym('php_fn_b', 5), sym('php_fn_a', 0)];
const legend = role === 'c' ? { tokenTypes: ['function', 'variable'], tokenModifiers: ['declaration'] }
  : { tokenTypes: ['variable', 'class'], tokenModifiers: ['readonly', 'declaration'] };
const tokens = role === 'c' ? [2, 4, 1, 0, 1] : [0, 6, 2, 0, 1, 0, 4, 3, 1, 0];
const send = (o) => { const s = JSON.stringify(o); process.stdout.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); };
let buf = Buffer.alloc(0);
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
    const len = +/Content-Length: (\d+)/.exec(buf.slice(0, i).toString())[1];
    if (buf.length < i + 4 + len) return;
    const m = JSON.parse(buf.slice(i + 4, i + 4 + len).toString()); buf = buf.slice(i + 4 + len);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { capabilities: { documentSymbolProvider: true, textDocumentSync: 1, semanticTokensProvider: { legend, full: true } } } });
    else if (m.method === 'shutdown') send({ jsonrpc: '2.0', id: m.id, result: null });
    else if (m.method === 'exit') process.exit(0);
    else if (m.method === 'textDocument/semanticTokens/full') send({ jsonrpc: '2.0', id: m.id, result: { data: tokens } });
    else if (m.method === 'textDocument/documentSymbol') send({ jsonrpc: '2.0', id: m.id, result: symbols });
  }
});
