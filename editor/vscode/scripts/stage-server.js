// Copy the LSP proxy and shadow generator into ./server so they ship inside the .vsix.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const out = path.resolve(__dirname, '../server');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'editor/lsp-proxy/cphp-lsp-proxy.js'), path.join(out, 'cphp-lsp-proxy.js'));
fs.copyFileSync(path.join(root, 'bin/cphp-shadow.php'), path.join(out, 'cphp-shadow.php'));
console.log('staged server files into ' + out);
