import * as vscode from 'vscode';
import { RobloxWSClient } from './wsClient';
import { RobloxCompletionProvider } from './completionProvider';
import { DecompileDocumentProvider, RobloxScriptExplorerProvider } from './scriptExplorerProvider';

let client: RobloxWSClient;
let statusBar: vscode.StatusBarItem;
let scriptExplorer: RobloxScriptExplorerProvider;

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('rotellisense');
  const port = config.get<number>('wsPort', 9000);

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'rotellisense.reconnect';
  setStatus('disconnected', port);
  statusBar.show();
  context.subscriptions.push(statusBar);

  // WebSocket client
  client = new RobloxWSClient(port);

  client.on('connected', () => {
    setStatus('connected', port);
    vscode.window.setStatusBarMessage(`$(check) Rotellisense: Connected on :${port}`, 3000);
  });

  client.on('disconnected', () => {
    setStatus('disconnected', port);
    scriptExplorer.handleDisconnected();
  });

  client.on('error', (msg: string) => {
    // Suppress socket errors from spam - only show unexpected ones
    if (!msg.includes('ECONNREFUSED') && !msg.includes('ECONNRESET')) {
      vscode.window.showErrorMessage(`Rotellisense: ${msg}`);
    }
  });

  // Completion provider for .lua and .luau
  const completionProvider = new RobloxCompletionProvider(client);
  scriptExplorer = new RobloxScriptExplorerProvider(client);
  const decompileProvider = new DecompileDocumentProvider();

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'lua' }, { language: 'luau' }],
      completionProvider,
      '.', // trigger on field/member access
      ':'  // trigger on method-style access
    ),
    vscode.window.registerTreeDataProvider('rotellisense.scriptsView', scriptExplorer),
    vscode.workspace.registerTextDocumentContentProvider('rotellisense-decompile', decompileProvider)
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('rotellisense.reconnect', () => {
      client.restart();
      setTimeout(() => client.connect(), 100);
      vscode.window.setStatusBarMessage(`$(sync~spin) Rotellisense: Restarting on :${port}...`, 2000);
    }),
    vscode.commands.registerCommand('rotellisense.searchScripts', async () => {
      await scriptExplorer.promptAndSearch();
    }),
    vscode.commands.registerCommand('rotellisense.refreshScripts', async () => {
      await scriptExplorer.refresh();
    }),
    vscode.commands.registerCommand('rotellisense.decompileScript', async (script: { id: string; name: string; path: string }) => {
      if (!script?.id) {
        return;
      }

      if (!client.connected) {
        vscode.window.showWarningMessage('Rotellisense: Connect the webhook before decompiling scripts.');
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Decompiling ${script.name}...`,
        cancellable: false
      }, async () => {
        try {
          const source = await client.requestScriptDecompile(script.id);
          const safeName = script.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
          const uri = vscode.Uri.parse(`rotellisense-decompile:/${safeName}.luau`);
          decompileProvider.setContent(uri, source || '-- Decompile returned empty content.');
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Rotellisense: Decompile failed: ${err?.message ?? 'unknown error'}`);
        }
      });
    })
  );

  // Connect on startup
  client.connect();

  // Re-read config on change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('rotellisense')) {
        vscode.window.showInformationMessage('Rotellisense: Reload window to apply config changes.');
      }
    })
  );
}

export function deactivate() {
  client?.disconnect();
}

function setStatus(state: 'connected' | 'disconnected', port: number) {
  const icons = {
    connected: '$(radio-tower)',
    disconnected: '$(debug-disconnect)'
  };
  const labels = {
    connected: `Rotellisense: Live :${port}`,
    disconnected: `Rotellisense: Offline :${port} (click to reconnect)`
  };
  statusBar.text = `${icons[state]} ${labels[state]}`;
  statusBar.backgroundColor = state === 'connected'
    ? undefined
    : new vscode.ThemeColor('statusBarItem.warningBackground');
}
