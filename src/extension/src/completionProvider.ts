import * as vscode from 'vscode';
import { RobloxWSClient, CompletionRequest } from './wsClient';
import { getMembersForClass } from './apiDump';

interface ParsedCompletionContext {
  query: CompletionRequest;
}

interface ParsedMethodContext {
  scope: string;
  serviceName: string;
  path: string;
}

interface CompletionProviderOptions {
  shouldProvideCompletions: () => boolean;
  isHybridWithLsp: () => boolean;
}

export class RobloxCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private client: RobloxWSClient,
    private options: CompletionProviderOptions
  ) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Thenable<vscode.CompletionItem[] | undefined> {
    if (!this.options.shouldProvideCompletions()) {
      return Promise.resolve(undefined);
    }

    if (!this.client.connected) {
      return Promise.resolve(undefined);
    }

    const linePrefix = document.lineAt(position).text.slice(0, position.character);

    // `:` trigger — resolve the instance class and return typed API members
    const methodCtx = this.parseMethodContext(linePrefix);
    if (methodCtx) {
      return this.client
        .requestResolveClass(methodCtx.scope, methodCtx.serviceName, methodCtx.path)
        .then(className => {
          if (!className) return undefined;
          const items = getMembersForClass(className);
          return items.length > 0 ? items : undefined;
        })
        .catch(() => undefined);
    }

    // `.` trigger — live path traversal (children)
    const parsed = this.parseContext(linePrefix);
    if (!parsed) {
      return Promise.resolve(undefined);
    }

    // In hybrid+LSP mode suppress root-level game.X completions to avoid duplicates —
    // robloxlsp already knows top-level services from its API dump. Only applies to the
    // raw `game.` scope; GetService/workspace scopes always need live children.
    if (this.options.isHybridWithLsp() && parsed.query.scope === 'game' && parsed.query.path === '') {
      return Promise.resolve(undefined);
    }

    return this.client.requestCompletions(parsed.query)
      .then(items => items.map(item => {
        const completion = new vscode.CompletionItem(item.label, vscode.CompletionItemKind.Field);
        completion.detail = `${item.detail} (live)`;
        completion.documentation = new vscode.MarkdownString(
          `**${item.detail}** (live)\n\nPath: \`${item.path}\``
        );
        completion.insertText = item.label;
        completion.sortText = item.label.toLowerCase();
        return completion;
      }))
      .catch(() => undefined);
  }

  // Matches `something:` at end of line — returns the scope/path of the instance before the colon
  private parseMethodContext(linePrefix: string): ParsedMethodContext | undefined {
    const normalized = linePrefix.trimEnd();
    if (!normalized || normalized.startsWith('--')) return undefined;
    if (!normalized.endsWith(':')) return undefined;

    // Strip trailing colon then re-use the same path regexes
    const beforeColon = normalized.slice(0, -1);

    const serviceMatch = beforeColon.match(/^.*\bgame[\.:]GetService\(['"](\w+)['"]\)((?:\.\w+)*)$/);
    if (serviceMatch) {
      const serviceName = serviceMatch[1];
      const pathWithPrefix = serviceMatch[2] ?? '';
      const path = pathWithPrefix.replace(/^\./, '').replace(/\.\w+$/, '').replace(/^\./, '');
      // The last segment IS the target instance, so path = everything up to (and including) last segment
      const fullPath = pathWithPrefix.replace(/^\./, '');
      return { scope: 'service', serviceName, path: fullPath };
    }

    const workspaceMatch = beforeColon.match(/^.*\bworkspace((?:\.\w+)+)$/i);
    if (workspaceMatch) {
      const fullPath = workspaceMatch[1].replace(/^\./, '');
      return { scope: 'workspace', serviceName: '', path: fullPath };
    }

    const gameMatch = beforeColon.match(/^.*\bgame((?:\.\w+)+)$/);
    if (gameMatch) {
      const fullPath = gameMatch[1].replace(/^\./, '');
      return { scope: 'game', serviceName: '', path: fullPath };
    }

    return undefined;
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
