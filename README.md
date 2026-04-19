# Rotellisense

Rotellisense connects VS Code to your Roblox game in real time, giving you live autocomplete, script search, and script decompile. all without leaving your editor.

<img width="768" height="322" alt="image" src="https://github.com/user-attachments/assets/a3f01490-4444-4d73-af99-a68c1ec968aa" />

---

## What It Does

- **Live autocomplete**. type `game:GetService("ReplicatedStorage").` and see your actual folders, RemoteEvents, and scripts as suggestions
- **Type-aware completions**. knows that a `RemoteEvent` has `:FireServer()`, `:FireClient()`, etc. without you needing to annotate anything
- **Script search**. search every script in your game from a sidebar panel
- **Script decompile**. click any search result to open its source in an editor tab

---

## Requirements

- VS Code 1.80+
- A Roblox executor that supports `WebSocket.connect`

---

## Setup

### 1) Install the extension

Download the latest `.vsix` from [Releases](https://github.com/nf-36/rotellisense/releases) and install it:

> VS Code → Extensions → `···` menu → Install from VSIX

### 2) Run the webhook script in Roblox

Place [RobloxWebhook.lua](src/lua/RobloxWebhook.lua) in your autoexec folder. You'll see the VS Code status bar change to **Rotellisense: Live** when you join a game.

### 3) Start coding

Open any `.lua` or `.luau` file and type `.` after a Roblox path. suggestions will pull directly from your live game.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `rotellisense.wsPort` | `9000` | Port the extension listens on (must match `WsUrl` in the Lua script) |
| `rotellisense.completionMode` | `hybrid` | `hybrid` merges live data with Roblox LSP · `webhook` uses only live data · `off` disables completions |

---

## Tips

- The status bar shows connection state at all times. If it says **Offline**, re-run the webhook script or restart Rotellisense
- If you changed the port in VS Code settings, update `WsUrl` in the Webhook script to match

---

## License

MIT - see [LICENSE](LICENSE)

## Statistics

[![Release Downloads](https://img.shields.io/github/downloads/nf-36/intellisense/total?label=Release%20Downloads)](https://github.com/nf-36/intellisense/releases)
<img src="https://visitor-badge.laobi.icu/badge?page_id=nf-36.intellisense&left_text=Views&left_color=111827&right_color=374151" alt="Visitors">
