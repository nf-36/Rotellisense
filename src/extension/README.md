# Rotellisense VS Code Extension

VS Code extension for on-demand Roblox IntelliSense, script search, and script decompile integration through a local WebSocket bridge.

## Features

- Hybrid completion mode that defers typed member completion to `nightrains.robloxlsp` when available
- Optional webhook-based completion for `game`, `workspace`, and `game:GetService(...)` traversal
- Script search tree view in the Rotellisense activity bar
- Open decompiled script output in a virtual Luau document
- Reconnect command and connection status in VS Code status bar

## Companion Script

This extension expects the executor-side webhook script in [luaclient/RobloxWebhook.lua](../luaclient/RobloxWebhook.lua) to be running.

Default port is `9000` on localhost.

## Development

```powershell
npm install
npm run compile
```

To package a VSIX:

```powershell
npm run vsix
```

## Configuration

- `rotellisense.wsPort`: Local WebSocket relay port.
- `rotellisense.completionMode`:
	- `hybrid` (default): use Roblox LSP completion when installed and enabled; fallback to Rotellisense webhook completion otherwise.
	- `webhook`: always use Rotellisense webhook completion.
	- `off`: disable Rotellisense completion (script search/decompile remains available).

## License

MIT. See [LICENSE](LICENSE).
