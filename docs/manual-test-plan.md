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
