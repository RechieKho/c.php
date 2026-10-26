'use strict';
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { findBuildDirFor, findServer } = require('./discovery');
const { version } = require('./package.json');

// One client (proxy + clangd) per workspace folder, so each folder gets its own build directory
// and settings. Documents outside every folder share the '' client.
const clients = new Map();   // folder key -> LanguageClient (or the pending start promise's client)
const warned = new Set();
const log = vscode.window.createOutputChannel('c.php');

const folderOf = (doc) => vscode.workspace.getWorkspaceFolder(doc.uri);
const keyOf = (folder) => (folder ? folder.uri.toString() : '');

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
  const args = [
    server.proxy,
    '--clangd', cfg.get('clangdPath') || 'clangd',
    '--php', cfg.get('phpPath') || 'php',
    '--shadow', server.shadow,
    '--cphp-version', version,
    ...(cfg.get('phpServer') ? ['--phpls', cfg.get('phpServer'), ...cfg.get('phpServerArgs', ['--stdio']).flatMap((a) => ['--phpls-arg', a])] : []),
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
