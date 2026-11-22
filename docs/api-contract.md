# Aurora Reader extension ↔ API contract

Status: documentation alignment only. The extension currently makes **no API requests**. The backend implementation in `../aurora-reader-api` (`app/main.py`, Pydantic schemas, services and generated OpenAPI) defines current server behavior; examples below illustrate shapes, not tested live inference. The API owns inference, not browser playback or reading state.

## Current browser implementation and planned boundary

The toolbar click grants `activeTab` and injects a top-level content script using `scripting`. Extraction runs in that script after activation: Readability on a filtered document copy, then a conservative `article`/`main` fallback. Hidden, navigation, form and editable content are excluded. `PageContent` holds `url`, `title`, nullable `language`, and ordered `TextChunk` entries `{ id, index, originalText, translatedText? }` (see `src/types/index.ts`). The `translatedText` slot exists but is not populated. The single Zustand store tracks document, `chunkIndex`, `pendingIndex`, `sessionId` and status; `starting` is also a current state. `SpeechPlayer` speaks `translatedText || originalText`, but currently uses the page language. Pause cancels speech and resume repeats the current chunk, not the exact word. Extraction increments `sessionId`; `watchPage` invalidates on URL/article changes after a debounce, and the audio hook ignores old speech callbacks by session ID. Stop cancels speech but **does not increment** `sessionId` or abort HTTP (none exists yet); future request operations need their own invalidation.

There is no API client, request DTO module, microphone recorder, target-language selector, upload consent flow, translation cache or Q&A state flow yet. `public/manifest.json` requests only `activeTab` and `scripting`; there is no API host permission, storage or offscreen permission. The service worker handles activation, not DOM, audio or persistent session truth. Do not interpret the existing domain fields or aspirational assistant states as an implemented network adapter.

## Origin, version and access

The implemented routes are `POST /api/v1/translate`, `POST /api/v1/ask`, `POST /api/v1/transcribe` and `GET /health`. `/health` returns `{"status":"ok"}` and reports process availability, **not** provider readiness. The backend exposes `/openapi.json` and `/docs`; runtime guards and service limits are not fully represented by OpenAPI field schemas.

For a future build, configure public `VITE_API_BASE_URL` (local only if explicitly set to `http://localhost:8000`; production HTTPS). It is currently unused. Grant only the configured API origin in extension host permissions and configure the actual `chrome-extension://<id>` origin in backend `ALLOWED_ORIGINS` when required. Default allowed origin `http://localhost:5173` is not an extension origin. Determine whether requests originate in the content script or an extension-owned context and verify actual MV3 origin/permission/CORS behavior in Chrome and Brave; do not assume `activeTab` grants backend access.

Local backend mode allows inference only from **loopback ASGI peers**, including identity translation. A browser on another machine cannot use this mode just because its URL says `localhost`. Production requires a server-held `X-Aurora-API-Key` (minimum 32 characters), an asserted trusted gateway, and secure configured origins at startup. That header is **gateway-to-backend only**: never bundle it or other provider/gateway secrets in a public extension or `VITE_` variable. The assertion does not prove a gateway exists. No browser-facing authentication protocol has been implemented; public deployment requires a real trusted gateway with user/session authentication, TLS, backend network isolation, distributed rate/cost quotas and abuse protection. CORS is not authentication. Do not expose paid inference publicly under the current local/process-only controls.

## Illustrative TypeScript wire DTOs (not source code)

```ts
type TranslationChunkDTO = { id: string; text: string };
type TranslationRequestDTO = {
  source_language: string;
  target_language: string;
  chunks: TranslationChunkDTO[];
};
type TranslationResponseDTO = TranslationRequestDTO;
type QuestionContextDTO = {
  title?: string;
  current_chunk?: string;
  related_chunks?: string[];
};
type QuestionRequestDTO = {
  question: string;
  language: string;
  context: QuestionContextDTO;
};
type AnswerSourceDTO = 'page' | 'general' | 'insufficient' | 'external' | 'mixed';
type QuestionResponseDTO = {
  answer: string;
  source: AnswerSourceDTO;
  context_sufficient: boolean;
};
// Multipart/form-data: required file (PCM WAV Blob), optional language (string).
type TranscriptionResponseDTO = { text: string; language: string | null };
type ApiErrorDTO = { error: { code: string; message: string; request_id: string } };
```

These mirror schema shapes; runtime checks add limits below. Although `external` and `mixed` are enum members in OpenAPI, the current backend **rejects** them; do not show them as supported retrieval modes. Unknown JSON properties are rejected. Runtime-validate responses rather than trusting types alone.

## Translation — `POST /api/v1/translate`

JSON request and illustrative response:

```json
{"source_language":"en","target_language":"es","chunks":[{"id":"chunk-001","text":"Neural networks learn patterns."}]}
```

```json
{"source_language":"en","target_language":"es","chunks":[{"id":"chunk-001","text":"Las redes neuronales aprenden patrones."}]}
```

Map `PageContent.language` to normalized `source_language` only when it is a valid known source tag; a missing/unsupported language requires a user decision or detection strategy (not a guessed `en`). Map the selected target to `target_language`; the target selector does not yet exist. Normalize ASCII case (`EN` → `en`, `es-mx` → `es-MX`); accepted syntax is `^[a-z]{2,3}(?:-[A-Z]{2})?$`. Backend `SUPPORTED_LANGUAGES` defaults to an empty list (syntax-only, not verified provider support); when configured, excluded tags return `422 UNSUPPORTED_LANGUAGE`. The OpenAI transcription adapter has extra hint restrictions described below.

For each chunk send `{ id: chunk.id, text: chunk.originalText }` in `index` order. IDs must be unique, 1–100 ASCII letters/digits/underscore/hyphen (`[A-Za-z0-9_-]+`); inspect generated IDs before sending. Server accepts 1–20 chunks, nonblank text of at most 4,000 characters per chunk and 20,000 characters combined; JSON body transport limit is 100,000 bytes. Batch long documents without dropping or duplicating chunks. Response must have identical count and IDs in the same order; match by ID **and verify order/count** before writing `translatedText` on the correct original chunk, retaining `index`/`originalText`. A mismatch, blank text, unexpected language or stale session should not change the document. The server returns same-language identity text without a provider (after access/rate/language checks); different-language requests need a configured provider or return `503 PROVIDER_UNAVAILABLE`. The backend rejects invalid or oversized provider output with `502 BAD_UPSTREAM_RESPONSE`. No translation cache or lazy translation exists in the extension today; if added, keep it ephemeral and keyed by document identity, target language and content, never persist page text by default. The speech language must be updated to the **target** when speaking translated text; it currently uses the page language.

## Contextual questions — `POST /api/v1/ask`

JSON request and illustrative response:

```json
{"question":"¿Qué significa una capa en una red neuronal?","language":"es","context":{"title":"Introduction to Deep Learning","current_chunk":"Neural networks consist of interconnected layers.","related_chunks":["Each layer applies transformations to its inputs."]}}
```

```json
{"answer":"Una capa transforma información antes de enviarla a la siguiente etapa.","source":"page","context_sufficient":true}
```

`question` is required, nonblank, max 1,000 characters; `language` is a required normalized response-language tag. `context` is required: `title` defaults to `""` (max 500 characters), `current_chunk` to `""`, `related_chunks` to `[]` (max five); raw combined context max 12,000 characters. Choose the current reading excerpt at the checkpoint plus only relevant, deduplicated excerpts, not the full article. The backend labels title and deduplicates text, never fetches the page URL. Return `answer` (nonblank, at most 2,000 characters by runtime validation), `source`, `context_sufficient`. `page` requires a nonblank current or related excerpt and `context_sufficient=true`; `general` and `insufficient` require `false`. `general` is unverified general model knowledge, **not** a page citation. Even `page` is a model-generated label with a structural excerpt check, not a factual guarantee. External search is not implemented. Keep answer narration separate from reading narration; answering must not advance the reading cursor and returns to paused until the user resumes. There is no such frontend flow yet.

## Transcription — `POST /api/v1/transcribe`

Send `multipart/form-data` with a required `file` part and optional `language` form field; let the browser supply the multipart boundary. Illustrative response:

```json
{"text":"¿Qué significa una capa en una red neuronal?","language":"es"}
```

The response language can be `null` if not uniquely detected; transcript must be nonblank and at most 4,000 characters (oversized/invalid provider results yield `502`). Request `file` must declare `audio/wav` and contain a complete RIFF/WAVE **PCM** payload: mono/stereo, 8/16/24/32-bit samples, consistent nonzero sample rate and frame alignment. The backend validates bytes, not filename. WAV data max 5,000,000 bytes, duration max 60 seconds; multipart transport cap 5,065,536 bytes. Empty/malformed WAV: `400 INVALID_AUDIO`; unsupported MIME/encoding: `415 UNSUPPORTED_MEDIA_TYPE`; oversize/duration: `413 PAYLOAD_TOO_LARGE`. Ogg/WebM **are not supported**. `MediaRecorder` often emits these formats; before enabling upload, verify browser capture capabilities and implement/test a bounded client-side PCM WAV capture or conversion with correct header, size/duration checks, cancellation and media-track cleanup. Do not relabel compressed bytes as WAV. Optional hint uses the same language syntax/allowlist; with the configured OpenAI adapter, regional hints other than `zh-CN`, `zh-TW`, `zh-HK` return `422 UNSUPPORTED_LANGUAGE`. A syntactically valid hint is not guaranteed to work with the provider. Recording and conversion are not implemented.

## Errors, consent and session validity

Application errors use JSON `{"error":{"code":"INVALID_INPUT","message":"The request could not be processed.","request_id":"opaque-id"}}`; `X-Request-ID` echoes the ID. Treat messages as safe feedback, not instructions. The backend also produces `404 NOT_FOUND` for unknown routes and `405 INVALID_INPUT` for unsupported methods. Known codes:

| HTTP | Code | Client treatment |
|---|---|---|
| 400 | `INVALID_AUDIO` | Retry capture with valid WAV |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` | Access configuration; do not send gateway keys from browser |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | Reduce payload or fix encoding |
| 422 | `INVALID_INPUT` / `UNSUPPORTED_LANGUAGE` | Correct fields/tag; no automatic retry |
| 429 | `RATE_LIMITED` / `PROVIDER_RATE_LIMITED` | Stop/retry only when user chooses; local rate limiter supplies `Retry-After` |
| 502 | `BAD_UPSTREAM_RESPONSE` / `PROVIDER_FAILURE` | Show provider failure; do not apply partial results |
| 503 | `PROVIDER_UNAVAILABLE` / `PROVIDER_QUOTA_EXCEEDED` | Explain backend/provider unavailable |
| 504 | `PROVIDER_TIMEOUT` | Offer an explicit retry |
| 500 | `INTERNAL_ERROR` | Generic safe failure |

The backend's default local per-peer rate limit is 60 requests/60 seconds per process, with four concurrent provider operations/process; provider deadline defaults to 30 seconds including semaphore wait. Text output budget defaults to 600 tokens (large translations may fail); no automatic SDK retries. Distinguish HTTP errors from network/offline and client abort; do not fabricate successful results or automatically retry microphone uploads. Non-identity requests fail `503` when the provider is disabled or lacks a key. OpenAPI describes typed routes but does not encode all guards, rate rules or audio byte validation.

Before **each relevant upload**, the user deliberately starts the action, sees what page excerpt or microphone audio will leave the browser and grants the required explicit consent. Extract only after activation; do not silently upload hidden content, credentials, unrelated browsing data or entire documents. Stop narration before recording; show recording and a stop control; clean up all tracks. The extension sends only necessary data, the backend validates it, and a configured provider may receive authorized page/question/audio content. Application code does not intentionally persist them, but multipart parsing may spool temporarily; provider `store=false` on text is not a zero-retention promise. Review provider/infrastructure retention disclosures before real-user use. No sensitive page text, audio, transcript or secrets in logs. Treat page text and returned text as untrusted data; render escaped text, never execute page instructions.

Future API requests need `AbortController`, deadline handling and a monotonically increasing operation token **in addition to** `sessionId`. Capture tab/document identity (URL plus document generation/content identity), selected languages, ordered chunk IDs and current checkpoint at request start. On Stop, close, navigation/re-extraction, changed language or a superseding question, abort requests and invalidate their operation token; ignore a response unless both operation and document identity still match. A server cancellation cannot guarantee provider work/billing stopped. No server response may set the player's cursor or resume it automatically.

## Remaining decisions / implementation checklist

1. Choose the safe browser request context, exact extension origin/CORS configuration, and narrow API host permission. Local loopback only for development; design a separate **browser-facing** authentication and deployment gateway before public inference.
2. Decide how an absent/untrusted page language becomes a confirmed source tag; define target language selection and verified supported-language list.
3. Add typed `src/types/api.ts`, a runtime-validating `src/services/api-client.ts`, consent UI, timeout/abort/error mapping; test both schema and runtime limits against generated OpenAPI plus real guarded responses.
4. Batch/lazily translate chunks; verify ID/order/count and session identity; keep an ephemeral cache if justified; speak in target language and preserve chunk checkpoints.
5. Select only bounded question excerpts, validate provenance display and implement paused → thinking → answering → paused without cursor movement.
6. Verify Chrome/Brave microphone access; capture or convert to validated PCM WAV within byte/duration bounds, clean up tracks and upload only with consent; never send WebM/Ogg to the current API.
7. Exercise end-to-end success, provider-offline, validation, denied microphone, abort/navigation, restricted pages, and security/privacy behavior in real browsers. No provider calls or frontend/backend integration were performed for this documentation task.
