# Aurora Reader extension ↔ API contract

Status: opt-in translation is integrated with the reader. No request occurs on activation or selection; transcription and contextual questions remain transport-only. The backend implementation in `../aurora-reader-api` (`app/main.py`, Pydantic schemas, services and generated OpenAPI) defines current server behavior; examples below illustrate shapes, not tested live inference. The API owns inference, not browser playback or reading state.

## Current browser implementation and planned boundary

The toolbar click grants `activeTab` and injects a top-level content script using `scripting`. Extraction runs after activation. `PageContent` holds `url`, `title`, nullable `language`, and ordered `{ id, index, originalText, translatedText? }` chunks. The single Zustand store tracks document/session identity, operation generation, consent for the current session, translation progress, narration mode and chunk checkpoint. The speech player explicitly selects original or validated translated text; pause replays the current chunk. Extraction increments `sessionId`; Stop increments the translation operation. URL and same-URL article replacement invalidate both speech and translation after the watcher debounce.

The API client, DTOs and runtime validation are reused by the widget's translation session. There is no microphone recorder or Q&A state flow. `public/manifest.json` requests only `activeTab` and `scripting`; the build adds one configured API host permission only when an origin is supplied. There is no storage or offscreen permission. The worker owns HTTP transport, not reading state.

## Origin, version and access

The implemented routes are `POST /api/v1/translate`, `POST /api/v1/ask`, `POST /api/v1/transcribe` and `GET /health`. `/health` returns `{"status":"ok"}` and reports process availability, **not** provider readiness. The backend exposes `/openapi.json` and `/docs`; runtime guards and service limits are not fully represented by OpenAPI field schemas.

Configure public `VITE_API_BASE_URL` (local explicitly with `VITE_API_MODE=local`, e.g. `http://127.0.0.1:8000`; production HTTPS). The build generates a host permission for only the configured scheme/host (Chrome patterns cannot constrain ports); the worker's client uses the exact configured origin. No URL means no API router or host permission. Configure the actual `chrome-extension://<id>` origin in backend `ALLOWED_ORIGINS` when required. Default allowed origin `http://localhost:5173` is not an extension origin. Requests originate from the extension service worker, not the page/content script. Verify actual MV3 origin/permission/CORS behavior in Chrome and Brave; do not assume `activeTab` grants backend access.

Local backend mode allows inference only from **loopback ASGI peers**, including identity translation. A browser on another machine cannot use this mode just because its URL says `localhost`. Production requires a server-held `X-Aurora-API-Key` (minimum 32 characters), an asserted trusted gateway, and secure configured origins at startup. That header is **gateway-to-backend only**: never bundle it or other provider/gateway secrets in a public extension or `VITE_` variable. The assertion does not prove a gateway exists. No browser-facing authentication protocol has been implemented; public deployment requires a real trusted gateway with user/session authentication, TLS, backend network isolation, distributed rate/cost quotas and abuse protection. CORS is not authentication. Do not expose paid inference publicly under the current local/process-only controls.

## Illustrative TypeScript wire DTOs (see `src/types/api.ts` for implementation)

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

Map `PageContent.language` to normalized `source_language` only when valid; a missing/unsupported language needs an explicit source selection (not a guessed `en`). The UI offers English and Spanish; `VITE_TRANSLATION_LANGUAGES` must mirror the deployment's enabled backend `SUPPORTED_LANGUAGES` before translated requests become available. Normalize ASCII case (`EN` → `en`, `es-mx` → `es-MX`); accepted syntax is `^[a-z]{2,3}(?:-[A-Z]{2})?$`. Backend `SUPPORTED_LANGUAGES` defaults to empty (syntax-only, not verified provider support); when configured, excluded tags return `422 UNSUPPORTED_LANGUAGE`.

For each chunk send `{ id: chunk.id, text: chunk.originalText }` in source order. IDs must be unique ASCII letters/digits/underscore/hyphen, 1–100 characters. The orchestration splits sequential batches within the server defaults: 1–20 chunks, 4,000 characters/chunk, 20,000 characters total and 100,000 bytes of UTF-8 JSON. A single oversized chunk fails before transmission. Deployment overrides smaller than these defaults require coordination. The existing API validator verifies response count, IDs, order, nonblank text and language before `translatedText` is written; store operation/session checks reject stale results. Completed batches stay in memory for explicit retry; no persistent cache. Translated narration waits for **all** batches and uses the target speech language. Same-language reading uses the original locally and never calls the API.

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

For translation, the user explicitly confirms that extracted page text goes to the configured Aurora backend and may be processed by an external AI provider for translation and narration. Consent is scoped to the current document/operation, not persisted, and invalidated by document/language changes and Stop; declining keeps local speech. The full extracted article is translated in bounded batches, not unrelated browser content; only chunk IDs/text and language tags leave the browser. Recording/transcription and question consent are not implemented. Application code does not intentionally persist page text; provider `store=false` on text is not a zero-retention promise. Review provider/infrastructure retention disclosures before real-user use. Never log sensitive content or execute page instructions.

Translation uses `AbortController`, a monotonically increasing operation token and `sessionId`. Stop, close, navigation/re-extraction or a language change abort active requests and invalidate the token; late results cannot mutate the next document. The translation UI, not a server response, initiates playback after all batches finish. Backend cancellation cannot guarantee provider billing stops.

## Remaining decisions / implementation checklist

1. Verify service-worker request context, extension origin/CORS behavior and generated narrow host permission in real browsers. Local loopback only for development; design a separate **browser-facing** authentication and deployment gateway before public inference.
2. Verify actual provider language support and configure `VITE_TRANSLATION_LANGUAGES` to match backend `SUPPORTED_LANGUAGES`; HTML language remains a user-correctable hint.
3. The typed DTOs, consent UI and background transport are implemented and offline-tested; test real guarded responses against OpenAPI before production use.
4. Translation uses sequential bounded batches and a full-document-before-speech policy; verify voice/checkpoint behavior in Chrome and Brave.
5. Select only bounded question excerpts, validate provenance display and implement paused → thinking → answering → paused without cursor movement.
6. Verify Chrome/Brave microphone access; capture or convert to validated PCM WAV within byte/duration bounds, clean up tracks and upload only with consent; never send WebM/Ogg to the current API.
7. Exercise end-to-end success, provider-offline, validation, abort/navigation, restricted pages, and security/privacy behavior in real browsers. Offline tests and a configured build do not establish live provider success; no provider calls were performed for this slice.
