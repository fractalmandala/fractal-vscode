# AGENTS.md — Fractal VS Code

Instructions for AI coding agents working in this repository.

## What this fork is

A personal fork of `microsoft/vscode` (`Code - OSS`, MIT). The fork's purpose is:

1. **Chat with any model via API** — stock BYOK Custom Endpoint provider, no Copilot
   sign-in. See `handoff.md` → "Key discovery" for why the chat core is untouched.
2. **Dev tools for customizing the editor itself** — annotation overlay and Fractal UI
   Edit Mode (see below).

The upstream repo (remote `upstream`) is `microsoft/vscode` and must never receive a push.
Our remote is `fractalmandala/fractal-vscode` (private).

## Fork-specific code (owned by us)

- `src/vs/workbench/contrib/fractalUi/browser/fractalUiEditMode.ts` — `🎨 UI Edit` mode
  (status bar + command palette): click-to-inspect styling, per-side border/padding/radius,
  codicon picker, **custom SVG upload** (file picker / pasted markup / URL) and raw
  per-selector **custom CSS**, localStorage-persisted overrides. Registered in both
  windows; active on desktop builds + web dev port. The old `✎ Annotate` overlay
  (devAnnotation, posted to `:4747`) was removed 2026-08-10 at user request — recoverable
  from git history.
- `src/vs/workbench/contrib/fractalNotes/browser/fractalNotesView.ts` — `Notes` view
  (secondary side bar): notepad over a user-chosen folder; timestamp-named `.md` notes,
  renameable, listed, opened in the editor. Registered in both windows.
- `src/vs/sessions/contrib/chat/browser/sessionTypePicker.ts` — filters the Copilot CLI
  harness (`copilotcli` / `agent-host-copilotcli`) out of the New Chat picker.
- `src/vs/workbench/contrib/chat/browser/widget/input/sessionTargetPickerActionItem.ts` —
  hides the `AgentHostCopilot` item from the main chat harness picker.
- `product.json` — Open VSX extensions gallery; `resources/darwin/code.icns`,
  `resources/linux/code.png`, `resources/win32/code.ico` generated from `logomotif.png`.

## Build / run (Node 24 via fnm — machine default v22 is too old)

```bash
fnm exec --using=24.19.0 -- npm run compile      # out/ (client + copilot)
fnm exec --using=24.19.0 -- ./scripts/code.sh    # desktop dev app
fnm exec --using=24.19.0 -- ./scripts/code-web.sh --port 9888   # web dev
fnm exec --using=24.19.0 -- npx gulp vscode-darwin-arm64        # production app
```

Long-running processes: launch detached (`python3 -c "subprocess.Popen(..., start_new_session=True)"`)
— the agent shell kills process groups on timeout.

## Coding guidelines

Follow the upstream guidelines (`.github/copilot-instructions.md`) for anything in shared
VS Code code. Additional rules for fork code:

- Mark fork-specific deviations with a comment (`// Fork customization: ...`) so upstream
  merges can review them.
- `compile-client` uses the stricter `tsgo` compiler — closure narrowing errors are real
  (hoist captured variables out of callbacks).
- Never put API keys in settings, config files, history, logs, or the renderer — secret
  storage (`${input:}` refs) only.
- The `:4747` agentation server and the user's own processes are off-limits.

## Session context

`handoff.md` is the living context contract for sessions on this fork — read it before
making changes, and update it when you learn something durable.
