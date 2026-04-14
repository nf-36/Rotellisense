import * as vscode from 'vscode';
import { RobloxWSClient, CompletionRequest } from './wsClient';

interface ParsedCompletionContext {
  query: CompletionRequest;
}

export class RobloxCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private client: RobloxWSClient) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Thenable<vscode.CompletionItem[] | undefined> {
    if (!this.client.connected) {
      return Promise.resolve(undefined);
    }

    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const parsed = this.parseContext(linePrefix);
    if (!parsed) {
      return Promise.resolve(undefined);
    }

    return this.client.requestCompletions(parsed.query)
      .then(items => items.map(item => {
        const completion = new vscode.CompletionItem(item.label, vscode.CompletionItemKind.Field);
        completion.detail = item.detail;
        completion.documentation = new vscode.MarkdownString(
          `**${item.detail}**\n\nPath: \`${item.path}\``
        );
        completion.insertText = item.label;
        completion.sortText = item.label.toLowerCase();
        return completion;
      }))
      .catch(() => undefined);
  }

  private parseContext(linePrefix: string): ParsedCompletionContext | undefined {
    const normalized = linePrefix.trimEnd();
    if (!normalized || normalized.startsWith('--')) {
      return undefined;
    }

    const serviceMatch = normalized.match(/^.*\bgame[\.:]GetService\(['"](\w+)['"]\)((?:\.\w*)*)$/);
    if (serviceMatch) {
      const serviceName = serviceMatch[1];
      const pathWithPrefix = serviceMatch[2] ?? '';
      const split = this.splitPath(pathWithPrefix);
      return {
        query: {
          scope: 'service',
          serviceName,
          path: split.path,
          prefix: split.prefix
        }
      };
    }

    const workspaceMatch = normalized.match(/^.*\bworkspace((?:\.\w*)*)$/i);
    if (workspaceMatch) {
      const pathWithPrefix = workspaceMatch[1] ?? '';
      const split = this.splitPath(pathWithPrefix);
      return {
        query: {
          scope: 'workspace',
          path: split.path,
          prefix: split.prefix
        }
      };
    }

    const gameMatch = normalized.match(/^.*\bgame((?:\.\w*)*)$/);
    if (gameMatch) {
      const pathWithPrefix = gameMatch[1] ?? '';
      const split = this.splitPath(pathWithPrefix);
      return {
        query: {
          scope: 'game',
          path: split.path,
          prefix: split.prefix
        }
      };
    }

    return undefined;
  }

  private splitPath(pathWithPrefix: string): { path: string; prefix: string } {
    const sanitized = pathWithPrefix.replace(/^\./, '');
    if (!sanitized) {
      return { path: '', prefix: '' };
    }

    const parts = sanitized.split('.').filter(part => part.length > 0);
    if (parts.length === 0) {
      return { path: '', prefix: '' };
    }

    if (pathWithPrefix.endsWith('.')) {
      return {
        path: parts.join('.'),
        prefix: ''
      };
    }

    const prefix = parts.pop() ?? '';
    return {
      path: parts.join('.'),
      prefix
    };
  }
}
