# Fractal VS Code

<p align="center">
  <img alt="Fractal VS Code logo" src="logomotif.png" width="120">
</p>

A personal fork of [Visual Studio Code](https://github.com/microsoft/vscode) (`Code - OSS`,
MIT license) built around one goal: **chat with any model via API — no Copilot sign-in
required** — plus a growing set of dev tools for customizing the editor itself.

This repo is a fork of `microsoft/vscode` (upstream commit `add9a510`), kept as the
`upstream` remote for future merges. Our remote is `fractalmandala/fractal-vscode` (private).

---

## What's different from stock VS Code

Everything below is a deliberate fork change. The rest of the codebase is upstream VS Code.

### 1. Chat with any model via API (the headline feature)

Stock VS Code's chat works signed-out via the **BYOK (Bring Your Own Key) Custom Endpoint**
provider, which ships inside the in-repo `extensions/copilot` extension:

- **Models → Add Models → Custom Endpoint** → provider config lives in
  `chatLanguageModels.json` (`vendor: customendpoint`, `apiType: chat-completions`,
  per-model `id` / `url` / `toolCalling` / `vision` / `maxInputTokens` / `maxOutputTokens`).
- API keys are stored as `${input:...}` secret references (keyring), never in the file.
- Works with any OpenAI-compatible endpoint: OpenRouter, Tokenrouter, Groq, LM Studio,
  Ollama, vLLM, or a local mock server. QA'd end-to-end against a mock OpenAI server
  (streaming, error paths, Stop mid-stream).

**No modifications to the 1,173-file chat core were needed** — this is built on the stable
extension API (`vscode.lm.registerLanguageModelChatProvider` / `vscode.chat.createChatAgent`),
so it's ours to extend without forking chat internals.

### 2. Copilot surfaces hidden (BYOK-only stance)

Since this build never signs in to GitHub Copilot, the **Copilot session type is removed**
from the New Chat widget and the main chat harness picker:

- `src/vs/sessions/contrib/chat/browser/sessionTypePicker.ts` — filters out the
  `copilotcli` / `agent-host-copilotcli` session types.
- `src/vs/workbench/contrib/chat/browser/widget/input/sessionTargetPickerActionItem.ts` —
  hides the `AgentHostCopilot` item.

### 3. Annotation overlay (dev tool)

A `✎ Annotate` button (bottom-right, dev builds only) that pins notes on any UI element
and posts them to a local annotation server (`:4747`), so an agent can read feedback via
`GET /pending`. Gated with `isDevSurface()` to web dev (port 9888) and desktop dev
(`vscode-file://vscode-app`) — a production packaging step must gate it off.

- `src/vs/workbench/contrib/devAnnotation/browser/devAnnotationOverlay.ts`

### 4. Fractal UI Edit Mode (dev tool)

A `🎨 UI Edit` status-bar toggle (or command palette: **Fractal: Toggle UI Edit Mode**)
that turns any element in the workbench into a live-styling target: background/text/border
colors, border width, radius, padding, font size/weight (per-side controls included),
plus a full codicon picker and SVG-icon-ready hooks. Overrides persist across reloads
(localStorage) and can be copied as CSS or reset per-element.

- `src/vs/workbench/contrib/fractalUi/browser/fractalUiEditMode.ts`
- Registered in both the main workbench and the Agents window (`sessions.common.main.ts`).

### 5. Extensions gallery (Open VSX)

The OSS build ships without a marketplace, so the Extensions view couldn't load results.
`product.json` now points the gallery at **Open VSX**.

### 6. Branding

The app icon is `logomotif.png`, rendered to:

- `resources/darwin/code.icns` (macOS app icon)
- `resources/linux/code.png` (512×512)
- `resources/win32/code.ico` (Windows)

---

## Building and running

Requires **Node 24** (this machine: `fnm exec --using=24.19.0`). See `handoff.md` for the
full setup notes and gotchas.

```bash
npm ci                                   # install (large; main + remote + extension deps)
npm run compile                          # out/ build (client + copilot extension)
npm run compile-web                      # web-extension dist for the browser build
./scripts/code.sh                        # desktop dev app (Electron)
./scripts/code-web.sh --port 9888        # web dev server
```

### Production build + DMG

```bash
npx gulp vscode-darwin-arm64             # produces VSCode-darwin-arm64/Code - OSS.app
# then package a DMG (hdiutil):
hdiutil create -volname "Fractal VS Code" -srcfolder VSCode-darwin-arm64/Code\ -\ OSS.app \
  -ov -format UDZO Fractal-VS-Code.dmg
```

Notes:

- `vscode-darwin-arm64` builds the copilot extension from source; on first run the packaging
  can hit a transient `lstat .../shims.txt` race with the extension's postinstall — re-running
  the task resolves it (the `@github/copilot` tree is then fully materialized).
- Long-running dev processes should be launched detached
  (`subprocess.Popen(..., start_new_session=True)`) so they survive shell reaping.

## Layout

- `src/vs/workbench/contrib/devAnnotation/` — annotation overlay (dev tool)
- `src/vs/workbench/contrib/fractalUi/` — UI Edit Mode (dev tool)
- `extensions/copilot/` — in-repo copilot-chat extension (BYOK provider lives here)
- `handoff.md` — session handoff / context contract for agents working on this fork
- `logomotif.png` — the app logo/icon source

## Contributing to upstream

This fork's upstream is `microsoft/vscode`. For anything not specific to the fork, prefer
contributing upstream — see the [VS Code contribution guide](https://github.com/microsoft/vscode/blob/main/CONTRIBUTING.md).

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license. The fork retains the upstream MIT license;
fork changes are subject to the same terms. Microsoft product name, logos, and the "Visual
Studio Code" trademark remain property of their respective owners.
