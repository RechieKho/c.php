'use strict';
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { findBuildDirFor, findServer } = require('./discovery');

let client = null;
let warned = false;
const log = vscode.window.createOutputChannel('c.php');

function folderFor(doc) {
  return (vscode.workspace.getWorkspaceFolder(doc.uri) || (vscode.workspace.workspaceFolders || [])[0] || {}).uri;
}

async function start(context, doc) {
  if (client) return;
  const server = findServer(context.extensionPath);
  if (!server) {
    vscode.window.showErrorMessage('c.php: LSP proxy not found in the extension. Reinstall the extension.');
    return;
  }
  const folderUri = doc && folderFor(doc);
  const cfg = vscode.workspace.getConfiguration('cphp', folderUri);
  const cmakeCfg = vscode.workspace.getConfiguration('cmake', folderUri);
  const buildDir = doc ? findBuildDirFor(doc.uri.fsPath, folderUri && folderUri.fsPath, {
    buildDirectory: cfg.get('buildDirectory') || '',
    cmakeBuildDirectory: cmakeCfg.get('buildDirectory') || '',
  }) : null;
  log.appendLine(`document: ${doc ? doc.uri.fsPath : '(none)'}; workspace folder: ${folderUri ? folderUri.fsPath : '(none)'}; build dir: ${buildDir || '(not found)'}`);
  if (!buildDir && !warned) {
    warned = true;
    vscode.window.showWarningMessage(
      'c.php: no compile_commands.json found. Configure the project with CMake (cphp_add_sources exports it) or set "cphp.buildDirectory". Using default clangd flags.',
      'Open Settings').then((c) => c && vscode.commands.executeCommand('workbench.action.openSettings', 'cphp.buildDirectory'));
  }
  const args = [
    server.proxy,
    '--clangd', cfg.get('clangdPath') || 'clangd',
    '--php', cfg.get('phpPath') || 'php',
    '--shadow', server.shadow,
    ...(buildDir ? ['--compile-commands-dir=' + buildDir] : []),
    ...cfg.get('clangdArgs', []),
  ];
  client = new LanguageClient('cphp', 'c.php (clangd)',
    { command: process.execPath, args, transport: TransportKind.stdio, options: { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } } },
    { documentSelector: [{ scheme: 'file', language: 'cphp' }] });
  await client.start();
}

async function stop() {
  const c = client;
  client = null;
  if (c) await c.stop();
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('cphp.restart', async () => {
      await stop();
      warned = false;
      const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
      await start(context, doc);
    }),
    vscode.workspace.onDidOpenTextDocument((d) => { if (d.languageId === 'cphp') start(context, d); }),
  );
  for (const d of vscode.workspace.textDocuments) if (d.languageId === 'cphp') { start(context, d); break; }
}

module.exports = { activate, deactivate: stop };
