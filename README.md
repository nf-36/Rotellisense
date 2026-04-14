# Rotellisense


Rotellisense is a VS Code extension plus a Roblox executor-side webhook script that provides on-demand Roblox IntelliSense, script search, and script decompile workflows from inside VS Code.

The project is split into:

- `extension/`: TypeScript VS Code extension that runs a local WebSocket relay and UI.
- `luaclient/`: Roblox-side Lua script (`RobloxWebhook.lua`) that connects to the relay, answers completion/search requests, and returns script source when possible.

## What It Does

- Autocomplete for common Roblox object traversal patterns (`game`, `workspace`, `game:GetService(...)`)
- Script search UI in a dedicated VS Code activity bar view
- One-click script decompile/open flow from search results
- Local-only connection (`127.0.0.1` / `localhost`) between VS Code and the webhook

## Architecture

1. VS Code extension starts a WebSocket server on `127.0.0.1:<port>` (default `9000`).
2. `RobloxWebhook.lua` connects to `ws://localhost:<port>` from your executor.
3. Extension sends request types: `complete`, `script_search`, `script_decompile`.
4. Lua client returns JSON response payloads that the extension renders in completion lists, tree view results, and virtual decompile documents.

## Requirements

- Windows (project currently tested on Windows workflows)
- Node.js 18+ (recommended)
- VS Code 1.80+
- A Roblox executor environment that supports `WebSocket.connect`
- `decompile` (optional but recommended)

## Quick Start

### 1) Build the VS Code extension

```powershell
cd extension
npm install
npm run compile
```

Optional package step:

```powershell
npm run vsix
```

### 2) Run the extension in VS Code

Open the `extension/` folder in VS Code, then run Extension Development Host (`F5`) from source.

Or install the built `.vsix` package.

### 3) Run the Roblox webhook script

Load and execute [luaclient/RobloxWebhook.lua](luaclient/RobloxWebhook.lua) in your executor.

Default URL in the script:

```lua
local WsUrl = "ws://localhost:9000"
```

If you changed the VS Code port setting, update `WsUrl` to match.

### 4) Use extension features

- Confirm status bar shows connected state.
- Open a `.lua` or `.luau` file and trigger completion with `.`.
- Open the Rotellisense activity view and run `Search Scripts`.
- Click a search result to decompile and view source in an editor tab.

## Extension Settings

- `rotellisense.wsPort` (number, default `9000`): WebSocket relay port used by the extension.

## Commands

- `Rotellisense: Reconnect WebSocket`
- `Rotellisense: Search Scripts`
- `Rotellisense: Refresh Script Results`
- `Rotellisense: Decompile Script`

## Development

### Workspace layout

```text
extension/
  src/
    extension.ts
    wsClient.ts
    completionProvider.ts
    scriptExplorerProvider.ts
luaclient/
  RobloxWebhook.lua
```

### Build commands

From `extension/`:

- `npm run clean`
- `npm run compile`
- `npm run watch`
- `npm run vsix`

## Troubleshooting

- Not connected: confirm the Lua webhook is running and `WsUrl` uses the same port as `rotellisense.wsPort`.
- Not connected: confirm another process is not already bound to port `9000` (or your configured port).
- No completions: parser currently targets `game`, `workspace`, and `game:GetService(...)` traversal patterns.
- Decompile returns empty: executor may not support `decompile` or may block source access for that instance.


## License
MIT License. See [LICENSE](LICENSE).

## Statistics

[![Release Downloads](https://img.shields.io/github/downloads/nf-36/intellisense/total?label=Release%20Downloads)](https://github.com/nf-36/intellisense/releases)
<img src="https://visitor-badge.laobi.icu/badge?page_id=nf-36.intellisense&amp;left_text=Views&amp;left_color=111827&amp;right_color=374151" alt="Visitors">