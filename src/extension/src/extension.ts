import * as vscode from 'vscode';
import { RobloxWSClient } from './wsClient';
import { RobloxCompletionProvider } from './completionProvider';
import { DecompileDocumentProvider, RobloxScriptExplorerProvider } from './scriptExplorerProvider';
import { writeProjectFiles, deleteProjectFiles, ensureGitignore } from './projectGenerator';

let client: RobloxWSClient;
let statusBar: vscode.StatusBarItem;
let scriptExplorer: RobloxScriptExplorerProvider;

type CompletionMode = 'hybrid' | 'webhook' | 'off';

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
    refreshTypesFromLive(false);
  });

  client.on('disconnected', () => {
    setStatus('disconnected', port);
    scriptExplorer.handleDisconnected();
    deleteProjectFiles();
  });

  client.on('error', (msg: string) => {
    // Suppress socket errors from spam - only show unexpected ones
    if (!msg.includes('ECONNREFUSED') && !msg.includes('ECONNRESET')) {
      vscode.window.showErrorMessage(`Rotellisense: ${msg}`);
    }
  });

  // Completion provider for .lua and .luau
  const completionProvider = new RobloxCompletionProvider(client, {
    shouldProvideCompletions: () => shouldUseWebhookCompletions(),
    isHybridWithLsp: () => shouldDeprioritizeWebhookCompletions()
  });
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
    vscode.commands.registerCommand('rotellisense.refreshTypes', async () => {
      await refreshTypesFromLive(true);
    }),
    vscode.commands.registerCommand('rotellisense.searchScripts', async () => {
      await scriptExplorer.promptAndSearch();
    }),
    vscode.commands.registerCommand('rotellisense.refreshScripts', async () => {
      await scriptExplorer.refresh();
    }),
    vscode.commands.registerCommand('rotellisense.executeScript', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Rotellisense: No active editor.');
        return;
      }

      if (!client.connected) {
        vscode.window.showWarningMessage('Rotellisense: Connect the webhook before executing scripts.');
        return;
      }

      const source = editor.document.getText();
      try {
        vscode.window.setStatusBarMessage('$(run) Rotellisense: Executing script...', 3000);
        const output = await client.executeScript(source);
        if (output) {
          vscode.window.showInformationMessage(`Rotellisense: ${output}`);
        } else {
          vscode.window.setStatusBarMessage('$(check) Rotellisense: Script executed.', 3000);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Rotellisense: Execution failed: ${err?.message ?? 'unknown error'}`);
      }
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

  // Ensure .gitignore excludes generated project file
  ensureGitignore();

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
  deleteProjectFiles();
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

function shouldUseWebhookCompletions(): boolean {
  const config = vscode.workspace.getConfiguration('rotellisense');
  const mode = config.get<CompletionMode>('completionMode', 'hybrid');

  return mode !== 'off';
}

function shouldDeprioritizeWebhookCompletions(): boolean {
  const config = vscode.workspace.getConfiguration('rotellisense');
  const mode = config.get<CompletionMode>('completionMode', 'hybrid');
  return mode === 'hybrid' && isRobloxLspCompletionsEnabled();
}

function isRobloxLspCompletionsEnabled(): boolean {
  const robloxLsp = vscode.extensions.getExtension('nightrains.robloxlsp');
  if (!robloxLsp) {
    return false;
  }

  const robloxLspConfig = vscode.workspace.getConfiguration('robloxLsp');
  return robloxLspConfig.get<boolean>('completion.enable', true);
}

async function refreshTypesFromLive(showFeedback: boolean): Promise<void> {
  if (!client.connected) {
    if (showFeedback) {
      vscode.window.showWarningMessage('Rotellisense: Not connected — run the webhook in Roblox first.');
    }
    return;
  }

  try {
    if (showFeedback) {
      vscode.window.setStatusBarMessage('$(sync~spin) Rotellisense: Fetching live type tree...', 5000);
    }
    const tree = await client.requestTreeDump();
    const written = writeProjectFiles(tree);
    if (written.length === 0) {
      if (showFeedback) {
        vscode.window.showWarningMessage('Rotellisense: No workspace folders to write type project file to.');
      }
      return;
    }
    // Prompt robloxlsp to reload by touching the file — it watches *.project.json
    if (showFeedback) {
      const choice = await vscode.window.showInformationMessage(
        `Rotellisense: Type tree written (${written.length} workspace folder(s)). Reload window for Roblox LSP to pick up new types?`,
        'Reload Now',
        'Later'
      );
      if (choice === 'Reload Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }
  } catch (err: any) {
    if (showFeedback) {
      vscode.window.showErrorMessage(`Rotellisense: Type tree dump failed — ${err?.message ?? 'unknown error'}`);
    }
  }
}
