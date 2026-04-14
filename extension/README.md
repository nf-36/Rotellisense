# Rotellisense VS Code Extension

VS Code extension for on-demand Roblox IntelliSense, script search, and script decompile integration through a local WebSocket bridge.

## Features

- Completion for `game`, `workspace`, and `game:GetService(...)` traversal
- Script search tree view in the Rotellisense activity bar
- Open decompiled script output in a virtual Luau document
- Reconnect command and connection status in VS Code status bar

## Companion Script

This extension expects the executor-side webhook script in [luaclient/RobloxWebhook.lua](https://github.com/nf-36/intellisense/blob/main/luaclient/RobloxWebhook.lua) to be running.

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

## License

MIT. See [LICENSE](LICENSE).
