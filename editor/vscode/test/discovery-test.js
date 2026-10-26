const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { hasGenerated, findBuildDir, findBuildDirFor, findServer, onPath, localIntelephense } = require('../discovery');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cphp-disc-'));
const mk = (rel, withDb = true) => {
  const d = path.join(tmp, rel);
  fs.mkdirSync(d, { recursive: true });
  if (withDb) fs.writeFileSync(path.join(d, 'compile_commands.json'), '[]');
  return d;
};
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

check('none found', () => assert.strictEqual(findBuildDir(mk('empty', false)), null));
check('workspace root database', () => { const w = mk('w1'); assert.strictEqual(findBuildDir(w), w); });
check('build/ directory', () => { const w = mk('w2', false); const b = mk('w2/build'); assert.strictEqual(findBuildDir(w), b); });
check('build/<config> subdir', () => { const w = mk('w3', false); const b = mk('w3/build/Debug'); assert.strictEqual(findBuildDir(w), b); });
check('freshest of several', () => {
  const w = mk('w4', false); const a = mk('w4/build-a'); const b = mk('w4/build-b');
  fs.utimesSync(path.join(a, 'compile_commands.json'), 1, 1);
  assert.strictEqual(findBuildDir(w), b);
});
check('cphp.buildDirectory is exclusive', () => {
  const w = mk('w5', false); mk('w5/build'); const x = mk('w5/custom');
  assert.strictEqual(findBuildDir(w, { buildDirectory: 'custom' }), x);
  assert.strictEqual(findBuildDir(w, { buildDirectory: 'missing' }), null);
});
check('cmake.buildDirectory with variables wins', () => {
  const w = mk('w6', false); mk('w6/build'); const x = mk('w6/out/Debug');
  assert.strictEqual(findBuildDir(w, { cmakeBuildDirectory: '${workspaceFolder}/out/${buildType}' }), x);
});
check('no workspace folder: walks up from the document', () => {
  const w = mk('w7', false); const b = mk('w7/build'); mk('w7/src/deep', false);
  assert.strictEqual(findBuildDirFor(path.join(w, 'src/deep/x.c.php'), undefined), b);
});
check('server found in repo layout', () => {
  const s = findServer(path.resolve(__dirname, '..'));
  assert(s && fs.existsSync(s.proxy) && fs.existsSync(s.shadow));
});

fs.rmSync(tmp, { recursive: true, force: true });

check('onPath finds an executable in PATH only', () => {
  const d = mk('bin', false);
  fs.writeFileSync(path.join(d, 'fake-ls'), '');
  assert(onPath('fake-ls', { PATH: ['/nonexistent', d].join(path.delimiter) }, 'linux'));
  assert(!onPath('other-ls', { PATH: d }, 'linux'));
  assert(!onPath('fake-ls', {}, 'linux'));
});
check('onPath honours PATHEXT on Windows', () => {
  const d = mk('winbin', false);
  fs.writeFileSync(path.join(d, 'fake-ls.CMD'), '');
  assert(onPath('fake-ls', { PATH: d, PATHEXT: '.EXE;.CMD' }, 'win32'));
});
check('localIntelephense needs the installed script', () => {
  const d = mk('store', false);
  assert.strictEqual(localIntelephense(d), null);
  const js = path.join(d, 'node_modules', 'intelephense', 'lib', 'intelephense.js');
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, '');
  assert.strictEqual(localIntelephense(d), js);
});
check('hasGenerated spots cphp-generated sources', () => {
  const w = mk('gen', false);
  fs.writeFileSync(path.join(w, 'compile_commands.json'), JSON.stringify([{ directory: w, file: '/p/main.c' }]));
  assert(!hasGenerated(w));
  fs.writeFileSync(path.join(w, 'compile_commands.json'), JSON.stringify([{ directory: w, file: '/p/main.c' }, { directory: w, file: '/p/build/cphp/table.c' }]));
  assert(hasGenerated(w));
  assert(!hasGenerated(path.join(w, 'nope')));
});
process.exit(failed ? 1 : 0);
