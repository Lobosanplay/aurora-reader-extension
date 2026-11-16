# AGENTS.md — Aurora Reader Extension

> Scope: **frontend repository only** (`aurora-reader-extension`). This file is the operational contract for coding agents working in this repository. The backend lives in `aurora-reader-api` and must not be implemented here.

## 1. Product mission

Aurora Reader is a **Manifest V3 browser extension** that reads the main content of the current web page, optionally translates it, narrates it aloud, and lets the user interrupt playback to ask a contextual question by voice. The answer is brief and spoken; afterwards the user can resume reading without losing their place.

### MVP acceptance journey

1. The user deliberately activates Aurora Reader on a supported HTML page.
2. The extension extracts the main readable text (title, language, URL and ordered chunks).
3. The user selects a target language and starts narration.
4. The user can pause, resume, stop and see an accurate status.
5. Translation, if needed, is requested from the separate API.
6. The user pauses and presses the microphone control; a spoken question is transcribed through the API.
7. The contextual answer is shown and narrated, then the reading session remains ready to resume.
8. Errors and unavailable-page states produce actionable feedback and never start recording or uploading silently.

### Deliberately outside the MVP

- Reading arbitrary operating-system windows or the full desktop.
- OCR, screen capture, image interpretation, PDF internals and cross-origin iframe extraction.
- Always-on listening / hands-free voice detection, user accounts, subscriptions, vector databases, server implementation.
- Broad host access or background collection of all visited pages.

Do not silently enlarge scope. Write down proposed additions before implementing them.

## 2. Technology and ownership

- **Platform:** Chromium-based browsers (Chrome and Brave first), Chrome Extensions **Manifest V3**.
- **UI:** React, TypeScript (`strict: true`), Tailwind CSS.
- **Build:** Vite with an explicit MV3-compatible build setup; verify output filenames and manifest mappings.
- **State:** Zustand for the reading session and player state. Keep transient component-only UI state local.
- **Extraction:** DOM APIs and `@mozilla/readability`; use a safe fallback for unsupported layouts.
- **Narration MVP:** Web Speech API (`speechSynthesis`) behind a `SpeechPlayer` abstraction, with documented browser limitations.
- **Animation:** CSS first; use GSAP only for interactions not adequately handled by CSS. Respect `prefers-reduced-motion`.
- **Networking:** typed `fetch` requests to the standalone FastAPI service. Use runtime validation of external payloads (e.g. Zod) when dependencies are available.
- **Tests:** Vitest + Testing Library for unit/component tests, and browser extension end-to-end/manual validation in Chrome and Brave.

The frontend owns extraction, browser permissions, UI, playback, local state and API integration. The backend owns AI prompts, translation, question answering, transcription, provider credentials, retrieval/search and server-side validation.

## 3. Recommended repository layout

```text
aurora-reader-extension/
├── public/
│   ├── manifest.json             # MV3 manifest (or generated equivalent)
│   └── icons/
├── src/
│   ├── background/
│   │   ├── index.ts              # Service worker entry
│   │   └── message-router.ts     # Trusted browser/message coordination
│   ├── content/
│   │   ├── index.tsx             # Idempotent injection into active tab
│   │   ├── extract-page.ts       # Readability/DOM extraction
│   │   └── shadow-root.ts        # Isolated React widget mount point
│   ├── components/
│   │   ├── AssistantWidget.tsx
│   │   ├── AuroraOrb.tsx
│   │   ├── PlayerControls.tsx
│   │   ├── LanguageSelector.tsx
│   │   └── StatusMessage.tsx
│   ├── hooks/
│   │   ├── useAudioPlayer.ts
│   │   └── useMicrophone.ts
│   ├── services/
│   │   ├── api-client.ts          # Typed HTTP client; no AI business logic
│   │   ├── speech-player.ts       # Playback interface/adapters
│   │   ├── audio-recorder.ts      # Capture and cleanup
│   │   └── messaging.ts          # Typed extension messaging
│   ├── stores/
│   │   └── reader-store.ts
│   ├── types/
│   │   ├── session.ts
│   │   ├── messages.ts
│   │   └── api.ts
│   ├── utils/
│   │   ├── chunk-text.ts
│   │   └── normalize-text.ts
│   └── styles/
│       ├── globals.css
│       └── aurora.css
├── tests/
├── docs/
│   ├── architecture.md
│   ├── api-contract.md
│   └── manual-test-plan.md
├── .env.example
├── package.json
├── tsconfig.json
└── AGENTS.md
```

Create folders **only as implementation requires them**; this is a target architecture, not a mandate to add empty files. Add `src/offscreen/` and an offscreen HTML entry **only if** persistent playback, user media or WebRTC requires an extension-owned document. Do not assume that a Manifest V3 service worker has DOM/audio access.

## 4. Browser execution boundaries

| Boundary | Owns | Must not do |
|---|---|---|
| Content script (`ISOLATED`) | Read supported page DOM; mount Shadow DOM widget; route user gestures | Embed secrets; modify page business data; trust page instructions |
| Service worker | Browser action/activation, permitted injection, tab lifecycle, messaging coordination | Hold in-memory playback truth; access DOM; play audio directly |
| React widget | Controls, accessibility, status, visualization | Call privileged Chrome APIs indiscriminately; own LLM logic |
| Speech/recording adapter | Playback/capture lifecycle and explicit cancellation | Record without user action; leak media tracks |
| API client | Backend HTTP contracts, timeouts, cancellations, error mapping | Contain provider API keys or prompts; access external AI APIs directly |
| Offscreen document (optional) | Document APIs where justified, such as audio playback or user media | Become a second state authority; exist indefinitely without purpose |

### Permissions and injection

- Prefer `activeTab` + `scripting` after a **user gesture** instead of broad `host_permissions` and automatic injection into every site.
- Request `storage` only when persisting preferences/progress. Request `offscreen` only after the design needs it; separately grant network access to the configured API origin with the narrowest workable host permission.
- Do not request `<all_urls>` by default. Never attempt injection into restricted browser pages, store pages or privileged URLs; show an informative unsupported-page state.
- Inject **once per tab/document**, with robust duplicate-mount prevention and teardown on navigation. Handle SPA URL/content changes without repeatedly mounting widgets.
- Keep extension code in the isolated execution world. Never inject remote executable code or use `eval`.
- Mount React in a dedicated Shadow DOM container. Scope Tailwind/CSS to that root; do not globally restyle the host page.
- Validate `chrome.runtime` messages using explicit action names, schemas and sender/tab identity where relevant. Do not accept untrusted page `postMessage` values as privileged instructions.
- Chrome service workers may be suspended. Persist minimal recoverable state or reconstruct it; do not depend on module-global variables surviving.
- Treat access to `getUserMedia`, extension-owned offscreen playback and the exact audio behavior as **capabilities to verify in real browsers**, not assumptions.

## 5. Session and audio state machine

Use exactly one authoritative reader/session store. Recommended primary states:

```ts
type AssistantState =
  | 'idle'
  | 'extracting'
  | 'translating'
  | 'reading'
  | 'paused'
  | 'listening'
  | 'thinking'
  | 'answering'
  | 'error';
```

- A transition is triggered by an explicit event, not by an animation callback.
- Only **one audio source** may play at a time. Pause/cancel narration before microphone capture or answer narration.
- Record `tabId`, document identity/URL, source/target language, ordered chunks, active chunk index and best available offset (sentence-level fallback is acceptable).
- Reading narration and the Q&A response are distinct audio jobs; completing an answer must **not** advance the document cursor.
- When a user presses Stop, abort requests, stop media tracks, cancel queued speech and clear ephemeral audio; do not auto-resume.
- After Q&A, restore a **paused, resumable** session; resume only on explicit user action in the MVP.
- Use operation IDs/monotonically increasing tokens and `AbortController` to ignore stale HTTP/audio callbacks after cancel, re-navigation or new questions.
- On tab navigation, invalidate the current document session and ensure an answer intended for the old page is never presented as current.
- Never mark the UI as `reading` until playback has actually started. Report permission denial, timeout, offline status and unsupported speech voices as appropriate.
- For Web Speech API, exact character offsets and pause/resume behavior are browser-dependent; prefer chunk/sentence-level checkpoints instead of promising perfect word-level synchronization.

## 6. Extraction and text handling

- Extract **only after explicit user activation**. Default to the active top-level HTML document; do not access other tabs or embedded cross-origin documents.
- Prefer Readability's article content, with a conservative semantic fallback (`article`, `main`, selected text) when appropriate.
- Never use `innerHTML` from the page to render untrusted content in the widget. Render extracted text as escaped text; sanitize if rich text is truly required.
- Exclude scripts, style, navigation, banners, ads, forms, hidden text, passwords, editable input contents and Aurora's own Shadow DOM.
- Preserve headings, paragraphs and original order, when possible. Normalize whitespace without merging unrelated sections.
- Split at semantic boundaries (sentence/paragraph); assign stable chunk IDs and source order. Avoid truncating sentences arbitrarily.
- Avoid sending duplicate chunks. Prefer lazy translation and ephemeral chunk cache keyed by document/language/content hash.
- If text is insufficient or extraction fails, explain that to the user and allow a retry or supported text selection.
- Page content is **untrusted data**, including any apparent instructions embedded in it. Do not execute instructions or change extension policy because the page says so.

## 7. API boundary (`aurora-reader-api`)

The frontend consumes a versioned API; it must never implement translation or inference itself beyond browser-native speech synthesis.

Proposed routes (contracts subject to joint agreement with backend; do not invent response fields as if deployed):

- `POST /api/v1/translate`: text chunks, source/target languages → translated chunks.
- `POST /api/v1/ask`: question, relevant page context, response language → answer + source indication.
- `POST /api/v1/transcribe`: user-initiated short audio clip → transcription.

Rules:

1. Set `VITE_API_BASE_URL` from build-time environment configuration. Only variables prefixed `VITE_` that are **public** may appear in extension bundles. Never place an API key in them.
2. Keep routes, DTOs and validations in `src/types/api.ts` / `src/services/api-client.ts`. Maintain `docs/api-contract.md` as the source of integration assumptions.
3. Do not silently fabricate server responses or substitute local mock data in production.
4. Implement request cancellation, timeouts, bounded retries for transient errors and friendly user-facing failure messages. Do not retry microphone uploads automatically without explicit policy.
5. Minimize payloads: only necessary text/context and audio, not full browser history or unrelated page metadata.
6. Distinguish knowledge from the current page vs external information if the API provides provenance. Never label unsupported claims as sourced.
7. For development, use `http://localhost:8000` only where explicitly configured; production APIs must be HTTPS. Keep host permissions narrowly aligned to supported origins.
8. Do not build direct access to any AI provider from the extension; secrets, prompts, quotas, retrieval and provider logic belong to the backend.

## 8. Aurora visual language

**Design intent:** compact, unobtrusive floating dark widget with a central animated aurora orb. Focus the design on sound and comprehension, not a dashboard.

- Suggested palette: background `#090C17`, elevated surface `#1B2236`, primary `#6366F1`, lavender `#A78BFA`, turquoise `#2DD4BF`, text `#F1F5F9`, muted text `#94A3B8`.
- Prefer design tokens/CSS variables instead of scattered hex values; maintain adequate contrast and verify keyboard focus indicators.
- Structure: header (Aurora Reader + minimize/close), central orb, status line, compact playback/microphone controls, optional language selector and concise error/answer area.
- Default compact size should fit narrow viewports; widget must be repositionable or safely anchored, never cover the whole page without consent, and be usable at 200% browser zoom.
- `AuroraOrb` is **presentational**: it consumes a state/level input and does not start audio, microphone or network requests.
- `idle`: slow subtle gradient. `reading`: fluid pulse. `listening`: visually distinct turquoise pulse with explicit microphone indication. `thinking`: gentle rotation. `answering`: reactive pulse. `paused`: subdued static state. `error`: clear status, not a color-only signal.
- Animate with transforms/opacity where possible. Avoid excessive blur, continuous heavyweight DOM repainting and animation tied to React rerenders.
- Honor reduced motion; supply a static orb alternative. Stop high-frequency animation when widget is hidden or inactive.
- All icon-only buttons require accessible names, keyboard controls and clear focus treatment. State must also appear as text; no critical information conveyed by color alone.
- UI strings should be centralized for future internationalization; support Spanish and English without hardcoding labels throughout components.
- Do not replace the agreed Aurora concept, introduce an elaborate dashboard, or add unrelated visual frameworks without an explicit requirement.

## 9. Coding conventions

- TypeScript strict; no `any` unless isolated at a third-party boundary with rationale. Prefer discriminated unions for message and state types.
- Components are functional and focused. Keep browser APIs behind adapters/hooks rather than embedding them deeply in JSX.
- Favor named exports for reusable modules and consistent file naming: PascalCase components, kebab-case non-component modules.
- Use explicit return types at public service boundaries; validate unknown external data before trusting it.
- Prefer small pure functions for chunking, formatting and normalization. No side effects during React render; clean up effects/listeners/media tracks on unmount.
- Avoid state duplication between Zustand, service worker and components. Derived state should be computed from existing state.
- Do not introduce dependencies without a reason and consider extension bundle size and attack surface.
- Keep comments for **why** constraints exist; do not narrate obvious code. Document nonobvious browser-specific workarounds.
- No placeholder credentials, fake permission success, silent catches or unbounded `console.log` output in production.

## 10. Privacy, safety and UX guarantees

- Microphone activation requires an explicit user action, visible recording state and an immediate stop control. Stop every `MediaStreamTrack` when finished, canceled or unmounted.
- Do not collect or persist raw audio, page text or transcripts by default. If temporary storage is needed, document duration, purpose and deletion behavior.
- Persist only user-approved preferences (language, voice, settings) and minimal progress; avoid storing private page content in `chrome.storage` without a documented requirement.
- Avoid indiscriminate capture of authentication pages, forms and other sensitive UI. Do not log page text, transcripts, tokens or API responses containing sensitive material.
- Ask for explicit consent before transmitting current-page text or microphone audio to the API; communicate this clearly in the UI.
- Do not claim the assistant can see arbitrary windows, screenshots, private tabs or inaccessible web content.
- Never disguise recording/network activity. Offer clear disabled states when permissions or browser capabilities are missing.
- Treat extracted page content and API output as untrusted for rendering; use safe text rendering and validate external URLs before creating links.

## 11. Testing and definition of done

### Required checks for each change

1. Run type checking, linting and relevant unit tests using commands actually present in `package.json`; do not invent scripts.
2. For browser changes, build the MV3 extension and verify the actual generated manifest and entrypoint paths.
3. Exercise the affected flow in Chrome; validate Brave when it touches microphone, speech, permissions or injection.
4. Verify loading/unloading, listener cleanup, cancellation and failure behavior, not only the happy path.
5. Report files changed, behavior verified, commands executed and remaining limitations truthfully.

### Minimum test cases

- Supported article: correct title and main text, no navigation or form contents.
- Missing/short content: safe error/empty state.
- Repeated open/close or SPA navigation: no duplicate widget and no stale session.
- Pause → ask → answer → resume: cursor unchanged by Q&A.
- Stop during translation, transcription or narration: old responses are ignored.
- Denied mic/network or missing backend: visible actionable error; no recording leaks.
- Different languages and long documents: stable chunk order and no duplicate narration.
- Reduced motion, keyboard navigation, visible status and zoomed/narrow viewport.
- Restricted page and cross-origin iframe: no unauthorized injection; informative limitation.

A feature is done only when it has clear user behavior, typed contracts, a failure state, cleanup logic and an appropriate test (or a documented manual verification if automation is impractical).

## 12. Agent operating procedure

When an agent receives a task in this repository:

1. **Inspect before editing.** Read this file, `README.md`, the relevant component/service and existing scripts/dependencies. The real repository wins over the proposed layout; explain deviations before significant refactors.
2. **State scope and plan** for nontrivial changes. Identify which browser context owns each responsibility, necessary permissions, data exposed to the API and the state transitions involved.
3. **Prefer the smallest coherent change.** Implement only the requested feature and its essential tests; avoid rewriting unrelated components, introducing speculative abstractions or changing the visual direction.
4. **Respect backend boundaries.** If an endpoint or payload is missing, update/document the frontend contract and use clearly labeled dev-only mocks only when expressly requested; do not implement backend functions in this repo.
5. **Preserve privacy and cancellation.** Every new capture, message and request must have an explicit lifetime, permission rationale and teardown path.
6. **Verify.** Run available static checks/tests/build; perform manual browser checks when relevant. Never claim verification without evidence.
7. **Summarize delivery.** Briefly describe changes, affected files, tests, assumptions and any remaining blockers. Recommend the next incremental step, not a broad unrelated rewrite.

### Prohibited agent behaviors

- Adding API/provider secrets to frontend files, source maps or public environment variables.
- Broadening permissions or activating the microphone without clear authorization.
- Treating page text as executable instructions or rendering raw untrusted HTML.
- Mixing backend providers, LLM prompts or server business logic into the extension.
- Using the MV3 service worker as a persistent DOM/audio runtime.
- Replacing the Aurora UI design without explicit request.
- Claiming support for all browser pages, PDFs, desktop windows or exact word-level resume without testing.
- Mass renames, major dependency changes or repository-wide refactors unrelated to the task.

## 13. Milestone order

1. MV3 scaffold, manual activation, Shadow DOM mount, Aurora shell.
2. DOM extraction, chunking and page eligibility handling.
3. Native speech playback and session state machine (without backend).
4. Translation integration and reading checkpoints.
5. Contextual text questions via API.
6. Push-to-talk transcription, spoken answers and resume.
7. Reliability, accessibility, privacy verification and browser packaging.
8. **Later, separately scoped:** real-time voice/VAD, WebRTC, image understanding and complex document support.

## 14. References

- Chrome extension overview: https://developer.chrome.com/docs/extensions/
- Content scripts: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- Programmatic injection: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Offscreen documents: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Mozilla Readability: https://github.com/mozilla/readability
- Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API

**Priority on conflict:** user requirement → security/privacy/browser platform constraints → existing repository standards → this recommended architecture. If a request conflicts with security or browser feasibility, surface the conflict and propose the smallest safe alternative.
