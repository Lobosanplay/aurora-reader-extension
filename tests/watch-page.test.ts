import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchPage } from '../src/content/watch-page';
import { useReaderStore } from '../src/stores/reader-store';
import { extractPage } from '../src/content/extract-page';

const paragraph = (text: string): string => `<p>${text.repeat(10)}</p>`;

afterEach(() => { vi.useRealTimers(); });

describe('active page watcher', () => {
  it('ignores widget and unrelated mutations and invalidates a replaced article', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main>${paragraph('First public article. ')}</main><aside></aside><div id="aurora-reader-host"></div>`;
    const changed = vi.fn(() => {
      useReaderStore.getState().beginExtraction();
      useReaderStore.getState().setDocument(extractPage(document));
    });
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(extractPage(document));
    useReaderStore.getState().started(0);
    const session = useReaderStore.getState().sessionId;
    const stop = watchPage(document, changed);
    document.querySelector('#aurora-reader-host')!.append(document.createElement('span'));
    document.querySelector('aside')!.textContent = 'An unrelated sidebar change';
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).not.toHaveBeenCalled();
    document.querySelector('main')!.outerHTML = `<main>${paragraph('Replacement article. ')}</main>`;
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenCalledOnce();
    expect(useReaderStore.getState().sessionId).toBe(session + 1);
    expect(useReaderStore.getState().status).toBe('idle');
    expect(useReaderStore.getState().document?.chunks[0].originalText).toContain('Replacement');
    stop();
  });
  it('coalesces rapid updates, detects URL changes and detaches cleanly', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main>${paragraph('Starting prose. ')}</main>`;
    const changed = vi.fn();
    const stop = watchPage(document, changed);
    const main = document.querySelector('main')!;
    main.textContent = 'First replacement';
    main.innerHTML = paragraph('Second replacement. ');
    main.innerHTML = paragraph('Final replacement. ');
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenCalledOnce();
    history.pushState({}, '', '/different-article');
    await vi.advanceTimersByTimeAsync(500);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    main.innerHTML = paragraph('After disconnect. ');
    await vi.advanceTimersByTimeAsync(700);
    expect(changed).toHaveBeenCalledTimes(2);
    history.replaceState({}, '', '/');
  });
  it('notifies when the mounted widget is removed', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main>${paragraph('Stable prose. ')}</main><div id="aurora-reader-host"></div>`;
    const changed = vi.fn();
    const stop = watchPage(document, changed, () => !!document.querySelector('#aurora-reader-host'));
    document.querySelector('#aurora-reader-host')!.remove();
    await vi.advanceTimersByTimeAsync(500);
    expect(changed).toHaveBeenCalledOnce();
    stop();
  });
  it('invalidates a paused session and ignores subsequent detached-page updates', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<article>${paragraph('Paused prose. ')}</article>`;
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(extractPage(document));
    useReaderStore.getState().started(0);
    useReaderStore.getState().pause();
    const previous = useReaderStore.getState().sessionId;
    const stop = watchPage(document, () => {
      useReaderStore.getState().beginExtraction();
      useReaderStore.getState().setDocument(extractPage(document));
    });
    document.querySelector('article')!.innerHTML = paragraph('Updated prose. ');
    await vi.advanceTimersByTimeAsync(200);
    expect(useReaderStore.getState()).toMatchObject({ sessionId: previous + 1, status: 'idle', chunkIndex: 0 });
    stop();
  });
  it('detects CSS-driven article switches but ignores hidden-content changes', async () => {
    vi.useFakeTimers();
    document.head.innerHTML = '<style>.concealed { display: none }</style>';
    document.body.innerHTML = `<article>${paragraph('First visible story. ')}</article>
      <article class="concealed">${paragraph('Second visible story. ')}</article>`;
    const changed = vi.fn();
    const stop = watchPage(document, changed);
    document.querySelectorAll('article')[1].textContent = 'A private hidden update.';
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).not.toHaveBeenCalled();
    document.querySelectorAll('article')[0].classList.add('concealed');
    document.querySelectorAll('article')[1].classList.remove('concealed');
    await vi.advanceTimersByTimeAsync(200);
    expect(changed).toHaveBeenCalledOnce();
    stop();
  });
});
