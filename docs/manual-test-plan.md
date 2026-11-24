# Phase 1 browser verification (Chrome and Brave)

Automated tests and the build smoke check do not replace a real extension run. Record browser/version and pass/fail for each item; do not infer Brave behavior from Chrome.

1. Run `npm run build`, load `dist/` unpacked from `chrome://extensions` or `brave://extensions`, then open an HTTP(S) article with several paragraphs. Click the toolbar action; confirm one floating widget and the correct article title/text.
2. Click the toolbar action repeatedly. Close and reopen the widget; confirm exactly one host and that closing stops speech. Reload the extension and the page, then activate again.
3. Start, Pause, Resume, Stop, rapidly repeat each action, and repeat with the tab in the background. Check the audible passage and displayed status; during delayed voice startup, expect “Preparing voice…” until audio starts. Pause and Stop must work during that interval.
4. In a test article, include class-hidden and inline-hidden paragraphs, hidden ancestors, editable text and a form. Confirm none is spoken, including at a responsive breakpoint. Content below the viewport must remain readable.
5. On an SPA, replace the article at the same URL while reading and while paused. Repeat with a URL change and several rapid replacements. Old narration must stop and cannot resume; the widget must show the new article or a retryable extraction error. Unrelated sidebar/widget updates must not restart it.
6. Click on `chrome://settings`/`brave://settings`, an extension-store page, an HTTP(S) PDF and another non-HTML response. Expect an informative `N/A` or `!` badge/title, never a false success.
7. Navigate all buttons with keyboard only. Check focus visibility, status announcements, narrow window width, 200% zoom, `prefers-reduced-motion`, and that neither host styling nor widget styling leaks across the Shadow DOM boundary.

Record failures with the page type, reproduction steps and browser version. Browser speech voices and PDF viewer script restrictions are platform-dependent.

## Translation verification (both browsers; local test backend, never paid requests by default)

Build with `.env.worker` configured for a loopback API and an explicit language intersection, e.g. `VITE_TRANSLATION_LANGUAGES=en,es`. Set backend `SUPPORTED_LANGUAGES` to include the same codes and configure the extension origin as needed. Use a mock/test provider or authorized test environment; do not infer real inference success from the offline suite.

1. Open an English and then a Spanish article. Verify the declared source hint, correction selector, target selector, and unknown-language prompt. Open/minimize/change target/decline consent; Network must show **no** translation request. Same-language Start reading must remain local.
2. Select a different target; inspect the consent text with keyboard/screen reader. Decline, then start original narration. Repeat and confirm. Only after confirmation should the worker send `POST /api/v1/translate`, with IDs/text/language tags but no URL/title; inspect the actual request.
3. On a document spanning several batches, verify sequential requests, passage progress, complete translated narration with the target voice, Pause → Resume checkpoint and Stop. Trigger a controlled backend failure in a later batch, retry, and check that only unfinished chunks are resent. Switch to Read original and verify the original voice/text.
4. During a pending batch, Stop, close, change target, navigate, and replace article content at the same URL. A late response must not update the new session or play speech; no additional batch may be sent after cancellation. Reopening a different document requires a new confirmation.
5. Check unavailable backend, timeout, rate limit, unsupported language, malformed response, provider error and long/oversized passage states; ensure actionable errors, no original-text corruption and no private text in logs. Verify 200% zoom, narrow width, keyboard focus, reduced-motion orb, Shadow DOM isolation and the generated manifest's single narrow backend permission.
