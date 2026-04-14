import * as vscode from 'vscode';
import { RobloxWSClient, ScriptSearchResultItem } from './wsClient';

class ScriptTreeItem extends vscode.TreeItem {
  constructor(public readonly script: ScriptSearchResultItem) {
    super(script.name, vscode.TreeItemCollapsibleState.None);
    this.description = script.className;
    this.tooltip = `${script.className}\n${script.path}`;
    this.contextValue = 'rotellisense.scriptItem';
    this.command = {
      command: 'rotellisense.decompileScript',
      title: 'Decompile Script',
      arguments: [script]
    };
    this.iconPath = new vscode.ThemeIcon('file-code');
  }
}

class InfoTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class RobloxScriptExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private scripts: ScriptSearchResultItem[] = [];
  private searchQuery = '';
  private loading = false;
  private lastError = '';

  constructor(private readonly client: RobloxWSClient) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    if (this.loading) {
      return [new InfoTreeItem('Searching scripts...')];
    }

    if (!this.client.connected) {
      return [new InfoTreeItem('Connect Roblox webhook to search scripts')];
    }

    if (this.lastError) {
      return [new InfoTreeItem(`Error: ${this.lastError}`)];
    }

    if (!this.searchQuery) {
      return [new InfoTreeItem('Run "Search Scripts" to find scripts')];
    }

    if (this.scripts.length === 0) {
      return [new InfoTreeItem(`No scripts found for "${this.searchQuery}"`)];
    }

    return this.scripts.map(script => new ScriptTreeItem(script));
  }

  async promptAndSearch(): Promise<void> {
    const query = await vscode.window.showInputBox({
      prompt: 'Search Roblox scripts by name',
      placeHolder: 'Example: player, remote, inventory',
      value: this.searchQuery
    });

    if (query === undefined) {
      return;
    }

    this.searchQuery = query.trim();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.searchQuery) {
      this.scripts = [];
      this.lastError = '';
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }

    if (!this.client.connected) {
      this.scripts = [];
      this.lastError = 'Not connected';
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }

    this.loading = true;
    this.lastError = '';
    this.onDidChangeTreeDataEmitter.fire();

    try {
      this.scripts = await this.client.requestScriptSearch(this.searchQuery, 250);
    } catch (err: any) {
      this.scripts = [];
      this.lastError = err?.message ?? 'Request failed';
    } finally {
      this.loading = false;
      this.onDidChangeTreeDataEmitter.fire();
    }
  }

  handleDisconnected(): void {
    this.scripts = [];
    this.loading = false;
    this.lastError = '';
    this.onDidChangeTreeDataEmitter.fire();
  }
}

export class DecompileDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly contents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '-- No decompiled content available.';
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }
}