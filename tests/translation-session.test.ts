import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationSession } from '../src/services/translation-session';
import { useReaderStore } from '../src/stores/reader-store';
import { ApiClientError } from '../src/services/api-errors';
import type { TranslationResponse } from '../src/types/api';

const page = (url = 'https://example.com/a', count = 2) => ({
  url, title: 'Article', language: 'en',
  chunks: Array.from({ length: count }, (_, index) =>
    ({ id: `chunk-${index}`, index, originalText: `Original passage ${index}` }))
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const response = (request: { source_language: string; target_language: string; chunks: { id: string; text: string }[] }) => ({
  ...request, chunks: request.chunks.map(({ id, text }) => ({ id, text: `Translated ${text}` }))
});

describe('translation session', () => {
  let instance: TranslationSession;
  let translate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(page());
    useReaderStore.getState().setTargetLanguage('es');
    translate = vi.fn(async (request) => response(request));
    instance = new TranslationSession({ translate });
  });
  afterEach(() => { instance.dispose(); });
  const consent = () => {
    useReaderStore.getState().requestConsent();
    useReaderStore.getState().authorizeTranslation();
  };
  it('requires a confirmation, preserves originals and narrates only after completion', async () => {
    await instance.translate();
    expect(translate).not.toHaveBeenCalled();
    useReaderStore.getState().requestConsent();
    await instance.translate();
    expect(translate).not.toHaveBeenCalled();
    consent();
    await instance.translate();
    expect(translate).toHaveBeenCalledWith({
      source_language: 'en', target_language: 'es',
      chunks: [{ id: 'chunk-0', text: 'Original passage 0' }, { id: 'chunk-1', text: 'Original passage 1' }]
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(useReaderStore.getState()).toMatchObject({ translationStatus: 'ready', translatedCount: 2, narration: 'translated' });
    expect(useReaderStore.getState().document?.chunks[0]).toMatchObject({
      originalText: 'Original passage 0', translatedText: 'Translated Original passage 0'
    });
    await instance.translate();
    expect(translate).toHaveBeenCalledTimes(1);
  });
  it('decline, same-language, and unknown-source cases never upload', async () => {
    useReaderStore.getState().requestConsent();
    useReaderStore.getState().declineConsent();
    await instance.translate();
    useReaderStore.getState().setTargetLanguage('en');
    await instance.translate();
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument({ ...page(), language: null });
    useReaderStore.getState().setTargetLanguage('es');
    consent();
    await instance.translate();
    expect(translate).not.toHaveBeenCalled();
    expect(useReaderStore.getState().document?.chunks[0].originalText).toBe('Original passage 0');
  });
  it('rejects a late result across same-URL replacement and revokes consent', async () => {
    const pending = deferred<TranslationResponse>();
    translate.mockImplementationOnce(() => pending.promise);
    consent();
    const running = instance.translate();
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument({ ...page(), title: 'Same URL replacement' });
    pending.resolve(response({ source_language: 'en', target_language: 'es', chunks: [{ id: 'chunk-0', text: 'Old' }] }));
    await running;
    expect(useReaderStore.getState()).toMatchObject({ consentSession: null, translationStatus: 'idle', translatedCount: 0 });
    expect(useReaderStore.getState().document?.chunks[0].translatedText).toBeUndefined();
    await instance.translate();
    expect(translate).toHaveBeenCalledTimes(1);
  });
  it('aborts between batches on stop or target change', async () => {
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(page('https://example.com/long', 21));
    consent();
    translate.mockImplementationOnce(async (request) => {
      useReaderStore.getState().stop();
      return response(request);
    });
    await instance.translate();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(useReaderStore.getState()).toMatchObject({ translationStatus: 'cancelled', consentSession: null });
    useReaderStore.getState().setTargetLanguage('en');
    expect(useReaderStore.getState().document?.chunks.every((chunk) => chunk.translatedText === undefined)).toBe(true);
  });
  it('retries only unfinished batches after an error', async () => {
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(page('https://example.com/long', 21));
    consent();
    translate.mockImplementationOnce(async (request) => response(request))
      .mockRejectedValueOnce(new ApiClientError('provider_failure', 'private details'));
    await instance.translate();
    expect(useReaderStore.getState()).toMatchObject({ translationStatus: 'error', translatedCount: 20 });
    expect(useReaderStore.getState().translationError).not.toContain('private');
    await instance.translate();
    expect(translate).toHaveBeenCalledTimes(3);
    expect(translate.mock.calls[2][0].chunks).toHaveLength(1);
    expect(useReaderStore.getState()).toMatchObject({ translationStatus: 'ready', translatedCount: 21 });
  });
  it('drops a delayed result after a rapid language change', async () => {
    const pending = deferred<TranslationResponse>();
    translate.mockImplementationOnce(() => pending.promise);
    consent();
    const running = instance.translate();
    useReaderStore.getState().setTargetLanguage('en');
    useReaderStore.getState().setTargetLanguage('es');
    pending.resolve(response({ source_language: 'en', target_language: 'es', chunks: [{ id: 'chunk-0', text: 'Old' }] }));
    await running;
    expect(useReaderStore.getState().document?.chunks[0].translatedText).toBeUndefined();
    expect(useReaderStore.getState().consentSession).toBeNull();
  });
  it('uses normalized Spanish source for English translation', async () => {
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument({ ...page(), language: 'ES' });
    useReaderStore.getState().setTargetLanguage('en');
    consent();
    await instance.translate();
    expect(translate.mock.calls[0][0]).toMatchObject({ source_language: 'es', target_language: 'en' });
  });
});
