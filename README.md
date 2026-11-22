# Aurora Reader

A small Manifest V3 extension for reading the current HTML article aloud using the browser's local Web Speech API. An API transport foundation exists, but the widget still has **no account, microphone, translation, or page-text upload**.

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
5. On a restricted browser page, the toolbar badge should show `N/A` and its hover title explains the limitation. Injection failures show `!` with a retry hint in the toolbar title.

## Phase 1 behavior

Extraction filters hidden and excluded elements using the live document's computed styles before Readability processes a clone; if it finds insufficient text, the reader falls back to `article` or `main`. It excludes navigation, forms, scripts, editable regions and the widget without modifying the page. Ordered paragraphs are split near sentence boundaries into chunks of up to roughly 520 characters where possible; unusually long sentences split at word boundaries, while an indivisible word may exceed the target. No extracted content is persisted.

The orb and status reflect pending speech, confirmed speech start, pause, resume, completion and errors. Pause cancels the active utterance and keeps a chunk checkpoint; Resume replays that chunk from the beginning once speech starts again. This avoids relying on inconsistent native pause events, but is **not word-level resume**. A speech job is canceled on Stop, close, or detected URL/article replacement, including same-URL SPA changes. Changes are checked after a short debounce, not instantaneously. Voice lists may be initially empty; the browser's default voice is used when no language match is available. Web Speech quality, voice availability and background-tab speech vary by browser/platform. Keep the tab open while reading.

The interface currently uses the browser UI language (Spanish or English). Narration uses the page's declared language if present. There is no target-language selector until translation integration. Unsupported pages include browser internal pages, extension stores, PDFs, and cross-origin frames. A restricted page cannot host the widget, so failure feedback is shown in the toolbar badge/title.

## API transport foundation (not connected to the widget)

The separate `aurora-reader-api` implements the versioned contract in `docs/api-contract.md`. `src/types/api.ts` describes wire DTOs; `src/types/index.ts` remains the reader's domain model (`originalText`, `index`, etc.). No automatic mapping or upload is performed. Runtime validators reject malformed success responses, unknown properties, unsupported answer-source labels, and translation IDs/count/order/language mismatches. `AuroraApiClient` uses native `fetch`, isolated fixed paths, no credentials, client deadlines and caller aborts; errors are sanitized, categorized and retain request IDs/Retry-After where present. There are no automatic retries. Health means process availability, not provider readiness.

For a local API build, copy `.env.example` to `.env.worker` (ignored by Git) or set `VITE_API_MODE=local VITE_API_BASE_URL=http://127.0.0.1:8000` in the environment before `npm run build`. Start the backend separately, and configure its `ALLOWED_ORIGINS` for the actual `chrome-extension://<id>` origin if needed. A build without a URL has **no API host permission or active API router**. Production requires an explicit HTTPS `VITE_API_BASE_URL` (without `VITE_API_MODE=local`) and a trusted browser-facing authentication gateway; the backend's `X-Aurora-API-Key` must never be bundled. Vite `VITE_` values are publicly inspectable. `dist/manifest.json` is generated with exactly one API scheme/host match pattern when configured. Chrome match patterns cannot constrain a port; the HTTP client still targets only the configured port and refuses redirects.

The future caller will use `BackgroundApi` in the content context. It sends typed, operation-specific messages with random IDs to the worker; the worker checks extension sender identity, top frame, document identity and URL, validates payloads and invokes only the fixed API methods. WAV uploads cross Chrome JSON messaging as bounded byte arrays before being reconstructed in the worker; no recorder or WAV conversion is included. Abort signals do not cross the message boundary: cancellation sends a second ID-bound message, discards late replies, and clears the worker's in-memory pending entry. Tab loading/removal aborts pending requests. Worker restart/disconnect rejects or times out callers; server/provider cancellation is best-effort and cannot guarantee billing stops. The reader session remains the sole playback authority. Consent, session invalidation and bounded excerpt selection are **not implemented**; no UI calls this API yet. Do not invoke it with page content or audio before adding explicit consent.

## Validation limits

Unit tests cover extraction, chunking, session transitions, SPA invalidation, activation messages and mocked speech events. The build smoke check validates the generated entrypoints, content-script startup, Shadow DOM host and repeated activation. Automated checks do not prove voice behavior, browser permission behavior, or accessibility at 200% zoom. Follow `docs/manual-test-plan.md` in Chrome and Brave.
