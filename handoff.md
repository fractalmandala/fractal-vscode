# Handoff — Fractal VS Code

> Read this first. It is the context contract for this session. The original port plan
> (`backup-fractalsvelte/sidex/docs/port-to-stock-vscode.md`) is **superseded** by the
> findings below — stock VS Code already covers the "chat with any model via API" goal, so
> the SideX chat panel port is no longer the critical path.

## Mission (unchanged)

Build a **long-lived, maintainable VS Code-based editor** with our **own evolving chat and
agent APIs**. We moved off the SideX fork (VS Code + Tauri) to a **stock VS Code fork** at
`/Users/amrit/fractal-vscode` because SideX's friction was almost entirely in the Tauri
platform layer.

## Status after 2026-08-09 session — verified working

- **Fork cloned + built + running.** `npm ci` done (Node 24 via fnm — see Setup). Desktop
  dev app runs via `./scripts/code.sh`; web dev server via `./scripts/code-web.sh --port 9888`.
- **Chat with any model via API: PROVEN, zero chat-core modifications.** Stock VS Code's
  BYOK **Custom Endpoint** provider (built into the in-repo `extensions/copilot` / copilot-chat
  extension) does exactly what SideX's chat panel was going to do:
  - Add Models → **Custom Endpoint** → group/name/API key → `chatLanguageModels.json`
    (`vendor: customendpoint`, `apiType: chat-completions|responses|messages`, model entries
    need `id`, `url`, `toolCalling`, `vision`, `maxInputTokens`, `maxOutputTokens`).
  - Keys stored via `${input:...}` secret refs (never in the file).
  - **No Copilot sign-in required** — BYOK is gated `isClientBYOKAllowed`: signed-out users
    are allowed (`extensions/copilot/src/extension/byok/common/byokProvider.ts`).
  - QA'd end to end against `backup-fractalsvelte/sidex/scripts/mock-openai-server.mjs`
    (port 18999): model discovery, 29-chunk stream (`mock-fast`), 61-chunk slow stream
    (`mock-slow`), HTTP 500 error (`mock-error`), and **Stop mid-stream** all pass.
  - The user also added a real provider (Tokenrouter, `kimi-k3-free`) — works.
- **Annotation overlay ported** (`src/vs/workbench/contrib/devAnnotation/browser/devAnnotationOverlay.ts`),
  registered in `workbench.common.main.ts`. Gated to web dev (9888) **and** desktop dev
  (`vscode-file://vscode-app`) via `isDevSurface()`; a production packaging step must gate it
  off. Posts to the user's `:4747` agentation server (off-limits — see Boundaries). Verified
  on both surfaces; the user leaves annotations there and the agent reads `GET /pending`.

## Where things live

- **Fork (target):** `/Users/amrit/fractal-vscode` — clone of `microsoft/vscode` (shallow,
  1 commit `add9a510`, 2026-08-09). Now pushed to `fractalmandala/fractal-vscode` (private);
  `microsoft/vscode` kept as the `upstream` remote. `git fetch --unshallow` later if full
  history is wanted for merges.
- **Old fork (reference):** `/Users/amrit/backup-fractalsvelte/sidex` — port sources intact
  (chat contrib, devAnnotation, `src-tauri/src/commands/chat.rs`, `scripts/mock-openai-server.mjs`).
  SideX dev stack is SHUT DOWN (launchd jobs removed, ports 1420/18999 free). Do not restart
  unless asked. (Port 18999 is currently used by the mock server for the fork's QA.)
- **Handoff for the old project:** `fractalengine-handoff.md` in `/Users/amrit/mandala/apps/fractalengine`.

## Key discovery — why the SideX chat port is NOT needed

1. Stock VS Code `main` **already ships a full Copilot Chat** in `src/vs/workbench/contrib/chat/`
   (1,173 files). Porting SideX's 11-file chat contrib into that directory would clobber stock
   chat. (SideX used its own ids: `workbench.view.sidexChat`, config `chat.providers`.)
2. The **copilot-chat extension is open-source and in-repo** (`extensions/copilot`, publisher
   GitHub) and implements **BYOK** with providers for OpenAI, Anthropic, xAI, Azure, Gemini,
   Ollama, OpenRouter, **CustomOAI**, and **CustomEndpoint** — registered via the **stable**
   extension API `vscode.lm.registerLanguageModelChatProvider` (`vscode.d.ts`).
3. So "add and chat with any model via API" works with **zero fork changes to the chat core**,
   and the extension API is the layer we own going forward (`vscode.chat.createChatAgent`,
   `registerLanguageModelChatProvider`).

## Revised roadmap

1. **Keep stock chat + BYOK as the in-house chat.** Drop/defer the `sidexChat` panel port.
   (It could return later for a fully-owned panel — keyring-first UX, `@file` context, custom
   provider UI — but it's no longer the critical path.)
2. **Fork customization pass** (from here the work is product work, not porting):
   - Branding: rename product (`product.json`), window title, icon, `Code - OSS Dev` → ours.
   - Default provider config + dev workflow (wire mock server into scripts).
   - Optionally patch `isClientBYOKAllowed` to guarantee BYOK even with a GitHub session
     (enterprise policy currently denies signed-in users without a Copilot token).
   - Own extension-API layer: sidex-branded agent + provider via `vscode.lm`/`vscode.chat`.
3. **`@git-diff` context** and session persistence come along via stock SCM + storage service
   (SideX deferred both).

## Setup (works on this machine — memory-tight, 16 GB used + swap)

```bash
cd /Users/amrit/fractal-vscode
fnm exec --using=24.19.0 -- npm ci        # ~1-2 GB; repo .nvmrc wants Node 24 (machine default is 22)
fnm exec --using=24.19.0 -- npm run compile       # out/ build (compile-client + compile-copilot)
fnm exec --using=24.19.0 -- npm run compile-web   # web-extension dist for the browser build
fnm exec --using=24.19.0 -- ./scripts/code.sh           # desktop dev app (Electron)
fnm exec --using=24.19.0 -- ./scripts/code-web.sh --port 9888   # web dev server
node /Users/amrit/backup-fractalsvelte/sidex/scripts/mock-openai-server.mjs  # mock on 18999
```

Notes: **Node 24.19.0 via fnm** (v22 at /usr/local/bin is too old for main). Long-running
dev processes must be launched detached (e.g. `python3 -c "subprocess.Popen(..., start_new_session=True)"`)
because the agent shell kills process groups on timeout; BACKGROUND mode is not implemented.
`compile-client` uses the stricter `tsgo` compiler — closure narrowing errors are real
(hoist captured vars). Dev servers: desktop = Electron window; web = port 9888 (handoff's
"9888" was SideX-era; stock `code-web.js` defaults to 8080 — pass `--port 9888` to match the
annotation overlay gate).

## Gotchas (QA fixes — do not re-introduce)

- **View open command:** `openCommandActionDescriptor` auto-registers its command id — do NOT
  also `CommandsRegistry.registerCommand` the same id (duplicate registration aborted workbench boot).
- **Monaco Button width:** `.monaco-text-button { width: 100% }` crushes flex siblings —
  override to `width: auto` where needed.
- **WindowVisibility is GONE** from stock `common/views.ts` — SideX's contribution used it;
  any port must drop it.
- **Annotation overlay in desktop app:** gate via `location.port` — desktop origin
  (`vscode-file://vscode-app`) has no port; web dev is 9888. Keep the `isDevSurface()` pattern
  and the production-gate comment.
- **Settings/keys:** provider keys go to secret storage (`${input:}` refs) — never in
  `chatLanguageModels.json`, settings.json, history, or logs.

## Boundaries / STOP conditions

- **Keys:** API keys go only to the OS keyring / secret storage — never settings.json, history,
  logs, or the renderer.
- **Context scope:** open-editor context only; anything beyond requires an explicit user toggle
  per message.
- **No pushes / no commits** without explicit go-ahead — *except* this session pushed
  `fractalmandala/fractal-vscode` (private) at the user's request; the `upstream` remote is
  `microsoft/vscode` and must never receive a push.
- The `:4747` agentation server and the user's own processes are off-limits.
