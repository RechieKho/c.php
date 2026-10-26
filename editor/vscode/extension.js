'use strict';
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { spawn } = require('child_process');
const { findBuildDirFor, findServer, onPath, localIntelephense } = require('./discovery');
const { version } = require('./package.json');

// One client (proxy + clangd) per workspace folder, so each folder gets its own build directory
// and settings. Documents outside every folder share the '' client.
const clients = new Map();   // folder key -> LanguageClient (or the pending start promise's client)
const warned = new Set();
const log = vscode.window.createOutputChannel('c.php');

const folderOf = (doc) => vscode.workspace.getWorkspaceFolder(doc.uri);
const keyOf = (folder) => (folder ? folder.uri.toString() : '');

const DISMISSED = 'cphp.intelephensePromptDismissed';
let installing = false;

// PHP server command for the proxy: the configured one, or for the default `intelephense` the
// PATH copy, else the copy this extension installed into its own storage (run with node, so
// Windows needs no .cmd shim). null: nothing usable.
function resolvePhpServer(context, cfg) {
  const name = cfg.get('phpServer');
  const extra = cfg.get('phpServerArgs', ['--stdio']);
  if (!name) return null;
  if (name !== 'intelephense' || onPath(name)) return { cmd: name, args: extra };
  const js = localIntelephense(context.globalStorageUri.fsPath);
  return js ? { cmd: process.execPath, args: [js, ...extra] } : null;
}

function offerIntelephense(context) {
  if (installing || context.globalState.get(DISMISSED)) return;
  installing = true;
  vscode.window.showInformationMessage(
    'c.php: PHP hover, completion and go-to-definition need a PHP language server. Install Intelephense (free tier, third-party, via npm) into the extension\'s own storage?',
    'Install', 'Not now', "Don't ask again").then(async (choice) => {
    if (choice === "Don't ask again") await context.globalState.update(DISMISSED, true);
    if (choice !== 'Install') { installing = false; return; }
    const dir = context.globalStorageUri.fsPath;
    try {
      await require('fs').promises.mkdir(dir, { recursive: true });
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'c.php: installing Intelephense' }, () => new Promise((resolve, reject) => {
        const p = spawn('npm', ['install', 'intelephense', '--prefix', dir, '--no-audit', '--no-fund'], { shell: process.platform === 'win32' });
        let err = '';
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', reject);
        p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `npm exited with ${c}`))));
      }));
      if (!localIntelephense(dir)) throw new Error('intelephense.js not found after install');
      vscode.window.showInformationMessage('c.php: Intelephense installed; restarting.');
      await vscode.commands.executeCommand('cphp.restart');
    } catch (e) {
      log.appendLine('Intelephense install failed: ' + e.message);
      vscode.window.showWarningMessage(`c.php: could not install Intelephense (${e.code === 'ENOENT' ? 'npm not found' : e.message}). Run "npm i -g intelephense" yourself.`);
    } finally { installing = false; }
  });
}

async function start(context, doc) {
  const folder = folderOf(doc);
  const key = keyOf(folder);
  if (clients.has(key)) return;
  const server = findServer(context.extensionPath);
  if (!server) {
    vscode.window.showErrorMessage('c.php: LSP proxy not found in the extension. Reinstall the extension.');
    return;
  }
  const folderUri = folder && folder.uri;
  const cfg = vscode.workspace.getConfiguration('cphp', folderUri || doc.uri);
  const cmakeCfg = vscode.workspace.getConfiguration('cmake', folderUri || doc.uri);
  const buildDir = findBuildDirFor(doc.uri.fsPath, folderUri && folderUri.fsPath, {
    buildDirectory: cfg.get('buildDirectory') || '',
    cmakeBuildDirectory: cmakeCfg.get('buildDirectory') || '',
  });
  log.appendLine(`document: ${doc.uri.fsPath}; workspace folder: ${folderUri ? folderUri.fsPath : '(none)'}; build dir: ${buildDir || '(not found)'}`);
  if (!buildDir && !warned.has(key)) {
    warned.add(key);
    vscode.window.showWarningMessage(
      'c.php: no compile_commands.json found. Configure the project with CMake (cphp_add_sources exports it) or set "cphp.buildDirectory". Using default clangd flags.',
      'Open Settings').then((c) => c && vscode.commands.executeCommand('workbench.action.openSettings', 'cphp.buildDirectory'));
  }
  const php = resolvePhpServer(context, cfg);
  if (!php && cfg.get('phpServer') === 'intelephense') offerIntelephense(context);
  const args = [
    server.proxy,
    '--clangd', cfg.get('clangdPath') || 'clangd',
    '--php', cfg.get('phpPath') || 'php',
    '--shadow', server.shadow,
    '--cphp-version', version,
    ...(php ? ['--phpls', php.cmd, ...php.args.flatMap((a) => ['--phpls-arg', a])] : []),
    ...(buildDir ? ['--compile-commands-dir=' + buildDir] : []),
    ...cfg.get('clangdArgs', []),
  ];
  const scope = folderUri ? { scheme: 'file', language: 'cphp', pattern: new vscode.RelativePattern(folder, '**/*') } : { scheme: 'file', language: 'cphp' };
  const client = new LanguageClient('cphp', folder ? `c.php (${folder.name})` : 'c.php',
    { command: process.execPath, args, transport: TransportKind.stdio, options: { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } } },
    {
      documentSelector: [scope],
      workspaceFolder: folder,
      // Intelephense wants storage paths; other servers ignore unknown options.
      initializationOptions: { storagePath: context.storageUri && context.storageUri.fsPath, globalStoragePath: context.globalStorageUri.fsPath },
    });
  clients.set(key, client);
  try {
    await client.start();
  } catch (e) {
    clients.delete(key);
    throw e;
  }
}

async function stopAll() {
  const all = [...clients.values()];
  clients.clear();
  await Promise.all(all.map((c) => c.stop().catch(() => {})));
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('cphp.restart', async () => {
      await stopAll();
      warned.clear();
      // Restart every folder that has an open template, not just the active one.
      for (const d of vscode.workspace.textDocuments) if (d.languageId === 'cphp') await start(context, d);
    }),
    vscode.workspace.onDidOpenTextDocument((d) => { if (d.languageId === 'cphp') start(context, d); }),
    // A removed folder's client would keep serving a stale build directory.
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      for (const f of e.removed) {
        const c = clients.get(keyOf(f));
        clients.delete(keyOf(f));
        if (c) c.stop().catch(() => {});
      }
    }),
  );
  for (const d of vscode.workspace.textDocuments) if (d.languageId === 'cphp') start(context, d);
}

module.exports = { activate, deactivate: stopAll };
