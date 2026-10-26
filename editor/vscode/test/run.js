// Grammar and problem-matcher tests. Grammar tests need VS Code's built-in C and
// PHP grammars (set CPHP_VSCODE_EXTENSIONS to the app's `extensions` dir).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const pkg = require('../package.json');
let failures = 0;
function check(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

// ---- problem matchers ----
const matcher = (n) => new RegExp(pkg.contributes.problemMatchers.find((m) => m.name === n).pattern.regexp);
check('cphp-gcc matches #line-mapped error', () => {
  const m = matcher('cphp-gcc').exec('/p/table.c.php:5:12: error: expected \';\' before \'}\' token');
  assert(m && m[1] === '/p/table.c.php' && m[2] === '5' && m[3] === '12' && m[4] === 'error');
});
check('cphp-gcc matches C:/ path without column', () => {
  const m = matcher('cphp-gcc').exec('C:/p/table.c.php:7: warning: unused variable');
  assert(m && m[1] === 'C:/p/table.c.php' && m[2] === '7' && m[4] === 'warning');
});
check('cphp-msvc matches', () => {
  const m = matcher('cphp-msvc').exec('C:\\p\\table.c.php(5,3): error C2143: syntax error: missing \';\'');
  assert(m && m[2] === '5' && m[3] === '3' && m[5] === 'C2143');
});
check('cphp-php matches expander output', () => {
  const m = matcher('cphp-php').exec('PHP Warning:  Undefined variable $x in /p/table.c.php on line 4'.replace('  ', ' '));
  assert(m && m[3] === '/p/table.c.php' && m[4] === '4');
});

// ---- grammar ----
const ext = process.env.CPHP_VSCODE_EXTENSIONS || '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions';
const files = {
  'source.cphp': path.join(__dirname, '../syntaxes/cphp.tmLanguage.json'),
  'source.c': path.join(ext, 'cpp/syntaxes/c.tmLanguage.json'),
  'source.php': path.join(ext, 'php/syntaxes/php.tmLanguage.json'),
};
if (!Object.values(files).every(fs.existsSync)) {
  console.log('skip grammar tests: built-in C/PHP grammars not found (set CPHP_VSCODE_EXTENSIONS)');
  process.exit(failures ? 1 : 0);
}

(async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
  await oniguruma.loadWASM(wasm);
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (s) => new oniguruma.OnigScanner(s),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope) => files[scope]
      ? vsctm.parseRawGrammar(fs.readFileSync(files[scope], 'utf8'), files[scope]) : null,
  });
  const grammar = await registry.loadGrammar('source.cphp');

  function tokenize(src) {
    let st = vsctm.INITIAL;
    return src.split('\n').map((line) => {
      const r = grammar.tokenizeLine(line, st);
      st = r.ruleStack;
      return r.tokens.map((t) => ({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes }));
    });
  }
  const has = (lines, ln, text, scope) =>
    lines[ln].some((t) => t.text === text && t.scopes.some((s) => s.startsWith(scope)));

  const src = fs.readFileSync(path.join(__dirname, '../../../tests/example-project/table.c.php'), 'utf8');
  const L = tokenize(src);

  check('C outside PHP: #include is C preprocessor', () => assert(has(L, 0, '#', 'keyword.control.directive')));
  check('PHP block: $ops is PHP variable inside embedded block', () => {
    const t = L[2].find((x) => x.text === 'ops');
    assert(t && t.scopes.includes('meta.embedded.block.php') && t.scopes.some((s) => s.includes('variable') && s.endsWith('.php')));
  });
  check('open tag is punctuation.section.embedded', () => assert(has(L, 2, '<?', 'punctuation.section.embedded.begin')));
  check('<?= is recognised', () => assert(L[4].some((t) => t.text.startsWith('<?') && t.scopes.some((x) => x.startsWith('punctuation.section.embedded.begin')))));
  check('C text between <?= tags stays C', () => {
    assert(has(L, 4, 'int', 'storage.type'));
    assert(has(L, 4, 'return', 'keyword.control'));
  });
  check('PHP expr inside <?= is PHP', () => {
    const t = L[4].find((x) => x.text === 'name');
    assert(t && t.scopes.includes('meta.embedded.block.php'));
  });
  check('text after ?> returns to C', () => {
    const t = L[4].find((x) => x.text === 'return');
    assert(t && !t.scopes.includes('meta.embedded.block.php'));
  });
  check('a PHP // comment ends at ?>', () => {
    const l = tokenize('<?php // note ?> int x;')[0];
    const t = l.find((x) => x.text === 'int');
    assert(t && !t.scopes.includes('meta.embedded.block.php') && t.scopes.some((s) => s.startsWith('storage.type')));
  });
  check('bare <? is not PHP (short_open_tag off)', () => {
    const l = tokenize('a <? b')[0];
    assert(!l.some((x) => x.scopes.includes('meta.embedded.block.php')));
  });

  process.exit(failures ? 1 : 0);
})();
