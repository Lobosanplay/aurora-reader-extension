# Aurora Reader

A small Manifest V3 extension for reading HTML articles aloud with the browser's Web Speech API, optionally translating after explicit content-sharing consent. No account, microphone, or contextual-question UI is implemented.

## Stack and architecture

React 19 + strict TypeScript + Zustand + Mozilla Readability + Tailwind CSS 4 + Vite 7 + Vitest. A two-pass Vite build emits a module service worker (`background.js`) and a self-contained IIFE content script (`content.js`) at stable paths referenced by `public/manifest.json`. This avoids a heavyweight extension build plugin and keeps the manifest auditable. Tailwind and component CSS are embedded as a style element **inside a closed Shadow DOM**; no site-wide stylesheet is injected.

The toolbar click grants temporary `activeTab` access; the service worker injects only into the active top-level HTTP(S) tab and sends a validated open message. The content script owns extraction, a single Zustand session, the widget and speech playback. Repeated clicks reuse the mounted widget. The widget is not loaded until activation. The worker never keeps playback state. An API-enabled build grants one configured API scheme/host; no storage, microphone, or offscreen permission is requested.

## Requirements and setup

- Node.js 20.19+ or 22.12+ (Node 24 is supported), npm
- Recent Chrome or Brave

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

`dist/` is the installable extension. Re-run `npm run build` after edits, then reload the extension from the browser's extensions page. There is no hot-reload server: script injection and MV3 behavior require an actual extension build.

### Load unpacked

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Turn on **Developer mode**, select **Load unpacked**, and choose this repository's `dist/` directory.
3. Open a normal HTTP(S) article containing several paragraphs. Click the **Aurora Reader** toolbar icon.
4. Check that the floating widget appears once, then try Start reading → Pause → Resume → Stop; minimize, close, and reopen it. Try a short/empty page and an SPA navigation as well.
5. With a configured backend, confirm the source language if the HTML declaration is missing/wrong, choose a supported target, select Translate & read, review the sharing notice, and confirm. Decline to continue local reading. Once all batches finish, translated narration begins. Try Read original and a retry after a failed batch.
6. On a restricted browser page, the toolbar badge should show `N/A` and its hover title explains the limitation. Injection failures show `!` with a retry hint in the toolbar title.

## Phase 1 behavior

Extraction filters hidden and excluded elements using the live document's computed styles before Readability processes a clone; if it finds insufficient text, the reader falls back to `article` or `main`. It excludes navigation, forms, scripts, editable regions and the widget without modifying the page. Ordered paragraphs are split near sentence boundaries into chunks of up to roughly 520 characters where possible; unusually long sentences split at word boundaries, while an indivisible word may exceed the target. No extracted content is persisted.

The orb and status reflect pending speech, confirmed speech start, pause, resume, completion and errors. Pause cancels the active utterance and keeps a chunk checkpoint; Resume replays that chunk from the beginning once speech starts again. This avoids relying on inconsistent native pause events, but is **not word-level resume**. A speech job is canceled on Stop, close, or detected URL/article replacement, including same-URL SPA changes. Changes are checked after a short debounce, not instantaneously. Voice lists may be initially empty; the browser's default voice is used when no language match is available. Web Speech quality, voice availability and background-tab speech vary by browser/platform. Keep the tab open while reading.

The interface uses the browser UI language (Spanish or English). Original narration uses the selected/declared page language when available. A missing or untrusted source-language hint requires an explicit source selection before translation; unknown is not treated as English. Unsupported pages include browser internal pages, extension stores, PDFs, and cross-origin frames.

## Translation and API transport

The separate `aurora-reader-api` implements the contract in `docs/api-contract.md`. Translation sends only original text and ordered IDs with source/target language tags after confirmation. It does not send URL, title, browser history or audio. Responses are validated for count, IDs, order and language before updating in-memory chunks. Errors are sanitized and paid inference is never automatically retried.

For a local API build, copy `.env.example` to `.env.worker` (ignored by Git) or set `VITE_API_MODE=local VITE_API_BASE_URL=http://127.0.0.1:8000 VITE_TRANSLATION_LANGUAGES=en,es` before `npm run build`. The language list must match the enabled backend `SUPPORTED_LANGUAGES` (restricted to English/Spanish UI choices); absent configuration disables translation. Backend's empty default supported list means syntax-only validation, **not** provider support. Start the backend separately and configure `ALLOWED_ORIGINS` for the actual extension origin if needed. Without a URL, there is **no API host permission or active API router**. Production needs HTTPS and a trusted browser-facing authentication gateway; never bundle the server's `X-Aurora-API-Key`. `VITE_` values are public. The generated manifest grants one configured scheme/host permission (Chrome patterns cannot constrain a port); the client targets only the configured port and refuses redirects.

`BackgroundApi` carries translation requests from the content context to the service worker; the worker checks sender and document identity and performs the fixed endpoint call. Requests run sequentially, bounded to 20 chunks, 4,000 characters/chunk, 20,000 characters total and 100,000 UTF-8 JSON bytes (server limits can be configured lower). Completed validated batches remain in memory for explicit retry; progress counts translated passages. The MVP waits for all batches before speaking in the target language, so it never mixes original and translated passages. Same-language reading is local without consent. Stop, close, language changes and URL/article replacement abort/ignore stale responses; backend provider cancellation is best-effort. Consent and page text are not persisted. Questions and WAV uploads are not connected to the UI.

## Validation limits

Unit tests cover extraction, chunking, session transitions, SPA invalidation, activation messages and mocked speech events. The build smoke check validates the generated entrypoints, content-script startup, Shadow DOM host and repeated activation. Automated checks do not prove voice behavior, browser permission behavior, or accessibility at 200% zoom. Follow `docs/manual-test-plan.md` in Chrome and Brave.
