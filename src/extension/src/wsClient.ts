import { WebSocketServer, WebSocket, RawData } from 'ws';
import { EventEmitter } from 'events';

export interface TreeNode {
  className: string;
  children?: TreeNode[] | Record<string, never>;
  name?: string;
}

export interface WSMessage {
  type: 'complete_result' | 'script_search_result' | 'decompile_result' | 'class_result' | 'tree_dump_result' | 'execute_result' | 'error';
  requestId?: string;
  items?: CompletionResultItem[];
  scriptItems?: ScriptSearchResultItem[];
  source?: string;
  className?: string;
  tree?: TreeNode;
  message?: string;
  success?: boolean;
  output?: string;
}

export interface CompletionRequest {
  scope: 'service' | 'workspace' | 'game';
  serviceName?: string;
  path: string;
  prefix: string;
}

export interface CompletionResultItem {
  label: string;
  detail: string;
  path: string;
}

export interface ScriptSearchResultItem {
  id: string;
  name: string;
  className: string;
  path: string;
}

export class RobloxWSClient extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private activeSocket: WebSocket | null = null;
  private _connected = false;
  private _destroyed = false;
  private pendingCompletions = new Map<string, {
    resolve: (items: CompletionResultItem[]) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private pendingScriptSearch = new Map<string, {
    resolve: (items: ScriptSearchResultItem[]) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private pendingDecompile = new Map<string, {
    resolve: (source: string) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private pendingClassResolve = new Map<string, {
    resolve: (className: string) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private pendingTreeDump = new Map<string, {
    resolve: (tree: TreeNode) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private pendingExecute = new Map<string, {
    resolve: (output: string) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(
    private port: number
  ) {
    super();
  }

  get connected() { return this._connected; }

  connect() {
    if (this._destroyed) return;

    // Stop any existing server before starting a new one
    this.stopServer();

    try {
      this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });
    } catch (err: any) {
      this.emit('error', `Failed to start WebSocket server: ${err.message}`);
      return;
    }

    this.wss.on('connection', (ws: WebSocket) => {
      // Terminate any previous socket so only one executor is active
      if (this.activeSocket) {
        this.activeSocket.removeAllListeners();
        this.activeSocket.terminate();
      }

      this.activeSocket = ws;
      this._connected = true;
      this.emit('connected');

      ws.on('message', (data: RawData) => {
        try {
          const msg: WSMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {
          // malformed JSON, skip
        }
      });

      ws.on('close', () => {
        if (this.activeSocket === ws) {
          this.activeSocket = null;
          this._connected = false;
          this.rejectAllPending(new Error('Roblox webhook disconnected'));
          this.emit('disconnected');
        }
      });

      ws.on('error', (err: Error) => {
        this.emit('error', err.message);
      });
    });

    this.wss.on('error', (err: Error) => {
      this.emit('error', `WebSocket server error: ${err.message}`);
    });
  }

  private stopServer() {
    if (this.activeSocket) {
      this.activeSocket.removeAllListeners();
      this.activeSocket.terminate();
      this.activeSocket = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this._connected = false;
    this.rejectAllPending(new Error('Roblox webhook unavailable'));
  }

  private handleMessage(msg: WSMessage) {
    switch (msg.type) {
      case 'complete_result':
        if (msg.requestId) {
          const pending = this.pendingCompletions.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingCompletions.delete(msg.requestId);
            pending.resolve(msg.items ?? []);
          }
        }
        break;
      case 'script_search_result':
        if (msg.requestId) {
          const pending = this.pendingScriptSearch.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingScriptSearch.delete(msg.requestId);
            pending.resolve(msg.scriptItems ?? []);
          }
        }
        break;
      case 'decompile_result':
        if (msg.requestId) {
          const pending = this.pendingDecompile.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingDecompile.delete(msg.requestId);
            pending.resolve(msg.source ?? '');
          }
        }
        break;
      case 'class_result':
        if (msg.requestId) {
          const pending = this.pendingClassResolve.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingClassResolve.delete(msg.requestId);
            pending.resolve(msg.className ?? '');
          }
        }
        break;
      case 'tree_dump_result':
        if (msg.requestId) {
          const pending = this.pendingTreeDump.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingTreeDump.delete(msg.requestId);
            pending.resolve(msg.tree ?? { className: 'DataModel' });
          }
        }
        break;
      case 'execute_result':
        if (msg.requestId) {
          const pending = this.pendingExecute.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingExecute.delete(msg.requestId);
            if (msg.success === false) {
              pending.reject(new Error(msg.message ?? 'Execution failed'));
            } else {
              pending.resolve(msg.output ?? '');
            }
          }
        }
        break;
      case 'error':
        if (msg.requestId) {
          const pending = this.pendingCompletions.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingCompletions.delete(msg.requestId);
            pending.reject(new Error(msg.message ?? 'Completion request failed'));
            return;
          }

          const pendingSearch = this.pendingScriptSearch.get(msg.requestId);
          if (pendingSearch) {
            clearTimeout(pendingSearch.timeout);
            this.pendingScriptSearch.delete(msg.requestId);
            pendingSearch.reject(new Error(msg.message ?? 'Script search request failed'));
            return;
          }

          const pendingDecompile = this.pendingDecompile.get(msg.requestId);
          if (pendingDecompile) {
            clearTimeout(pendingDecompile.timeout);
            this.pendingDecompile.delete(msg.requestId);
            pendingDecompile.reject(new Error(msg.message ?? 'Script decompile request failed'));
            return;
          }

          const pendingClass = this.pendingClassResolve.get(msg.requestId);
          if (pendingClass) {
            clearTimeout(pendingClass.timeout);
            this.pendingClassResolve.delete(msg.requestId);
            pendingClass.reject(new Error(msg.message ?? 'Class resolve request failed'));
            return;
          }

          const pendingTree = this.pendingTreeDump.get(msg.requestId);
          if (pendingTree) {
            clearTimeout(pendingTree.timeout);
            this.pendingTreeDump.delete(msg.requestId);
            pendingTree.reject(new Error(msg.message ?? 'Tree dump request failed'));
            return;
          }
        }
        this.emit('error', msg.message ?? 'Unknown error from Roblox webhook');
        break;
    }
  }

  private rejectAllPending(err: Error) {
    for (const [requestId, pending] of this.pendingCompletions.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
      this.pendingCompletions.delete(requestId);
    }

    for (const [requestId, pending] of this.pendingScriptSearch.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
      this.pendingScriptSearch.delete(requestId);
    }

    for (const [requestId, pending] of this.pendingDecompile.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
      this.pendingDecompile.delete(requestId);
    }

    for (const [requestId, pending] of this.pendingClassResolve.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
      this.pendingClassResolve.delete(requestId);
    }

    for (const [requestId, pending] of this.pendingTreeDump.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
      this.pendingTreeDump.delete(requestId);
    }

    for (const [requestId, pending] of this.pendingExecute.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(err);
      this.pendingExecute.delete(requestId);
    }
  }

  async requestCompletions(query: CompletionRequest): Promise<CompletionResultItem[]> {
    if (!this.activeSocket || !this._connected || this.activeSocket.readyState !== WebSocket.OPEN) {
      return [];
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<CompletionResultItem[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCompletions.delete(requestId);
        reject(new Error('Completion request timed out'));
      }, 1200);

      this.pendingCompletions.set(requestId, { resolve, reject, timeout });
      this.send({
        type: 'complete',
        requestId,
        scope: query.scope,
        serviceName: query.serviceName ?? '',
        path: query.path,
        prefix: query.prefix
      });
    });
  }

  async requestTreeDump(): Promise<TreeNode> {
    if (!this.activeSocket || !this._connected || this.activeSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<TreeNode>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTreeDump.delete(requestId);
        reject(new Error('Tree dump timed out'));
      }, 15000);

      this.pendingTreeDump.set(requestId, { resolve, reject, timeout });
      this.send({ type: 'tree_dump', requestId });
    });
  }

  async requestResolveClass(scope: string, serviceName: string, path: string): Promise<string> {
    if (!this.activeSocket || !this._connected || this.activeSocket.readyState !== WebSocket.OPEN) {
      return '';
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingClassResolve.delete(requestId);
        reject(new Error('Class resolve timed out'));
      }, 1200);

      this.pendingClassResolve.set(requestId, { resolve, reject, timeout });
      this.send({
        type: 'resolve_class',
        requestId,
        scope,
        serviceName,
        path
      });
    });
  }

  async requestScriptSearch(query: string, limit = 250): Promise<ScriptSearchResultItem[]> {
    if (!this.activeSocket || !this._connected || this.activeSocket.readyState !== WebSocket.OPEN) {
      return [];
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<ScriptSearchResultItem[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingScriptSearch.delete(requestId);
        reject(new Error('Script search timed out'));
      }, 3000);

      this.pendingScriptSearch.set(requestId, { resolve, reject, timeout });
      this.send({
        type: 'script_search',
        requestId,
        query,
        limit
      });
    });
  }

  async requestScriptDecompile(scriptId: string): Promise<string> {
    if (!this.activeSocket || !this._connected || this.activeSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Roblox webhook is not connected');
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDecompile.delete(requestId);
        reject(new Error('Script decompile timed out'));
      }, 5000);

      this.pendingDecompile.set(requestId, { resolve, reject, timeout });
      this.send({
        type: 'script_decompile',
        requestId,
        scriptId
      });
    });
  }

  async executeScript(source: string): Promise<string> {
    if (!this.activeSocket || !this._connected || this.activeSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Roblox webhook is not connected');
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingExecute.delete(requestId);
        reject(new Error('Script execution timed out'));
      }, 15000);

      this.pendingExecute.set(requestId, { resolve, reject, timeout });
      this.send({ type: 'execute_script', requestId, source });
    });
  }

  send(obj: object) {
    if (this.activeSocket && this._connected && this.activeSocket.readyState === WebSocket.OPEN) {
      this.activeSocket.send(JSON.stringify(obj));
    }
  }

  restart() {
    this.stopServer();
  }

  disconnect() {
    this._destroyed = true;
    this.stopServer();
  }
}
