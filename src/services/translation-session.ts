import { BackgroundApi } from './messaging';
import { ApiClientError } from './api-errors';
import { buildTranslationBatches } from './translation-batches';
import { useReaderStore } from '../stores/reader-store';

const feedback = (error: unknown): string => {
  if (!(error instanceof ApiClientError)) return 'Translation failed. Retry or read the original text.';
  switch (error.category) {
    case 'validation': return error.status === 413 ? 'A passage exceeds the server limit. Read the original text.'
      : error.status === 422 ? 'This language is not supported by the server. Choose another language.'
        : 'This passage cannot be translated. Read the original text.';
    case 'unauthorized': return 'Translation access is unavailable. Check your API setup.';
    case 'rate_limited': return 'Translation is rate-limited. Retry later.';
    case 'provider_unavailable': return 'The translation provider is unavailable. Retry later or read the original.';
    case 'provider_failure':
    case 'malformed_response': return 'The server could not return a valid translation. Retry or read the original.';
    case 'provider_timeout':
    case 'timeout': return 'Translation timed out. Retry or read the original.';
    default: return 'Cannot reach the translation server. Check your connection and retry.';
  }
};

export class TranslationSession {
  private controller: AbortController | null = null;
  private unsubscribe: () => void;

  constructor(private readonly api: Pick<BackgroundApi, 'translate'> = new BackgroundApi()) {
    this.unsubscribe = useReaderStore.subscribe((state, previous) => {
      if (state.sessionId !== previous.sessionId || state.translationOperation !== previous.translationOperation) {
        this.controller?.abort();
        this.controller = null;
      }
    });
  }

  async translate(): Promise<void> {
    const state = useReaderStore.getState();
    if (!state.document || !state.sourceLanguage || state.sourceLanguage === state.targetLanguage ||
      state.consentSession !== state.sessionId || state.translationStatus === 'translating' ||
      state.translationStatus === 'ready') return;
    const operation = state.translationOperation;
    const document = state.document;
    const session = state.sessionId;
    const source = state.sourceLanguage;
    const target = state.targetLanguage;
    const valid = (): boolean => {
      const current = useReaderStore.getState();
      return current.sessionId === session && current.translationOperation === operation &&
        current.document?.url === document.url && current.sourceLanguage === source &&
        current.targetLanguage === target && current.consentSession === session;
    };
    let batches;
    try {
      batches = buildTranslationBatches(document.chunks, source, target);
    } catch (error) {
      state.beginTranslation(operation);
      useReaderStore.getState().failTranslation(operation, feedback(error));
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    state.beginTranslation(operation);
    try {
      for (const batch of batches) {
        if (!valid() || controller.signal.aborted) return;
        const remaining = batch.chunks.filter((chunk) =>
          !useReaderStore.getState().document?.chunks.some((item) => item.id === chunk.id && item.translatedText !== undefined));
        if (!remaining.length) continue;
        const response = await this.api.translate({ ...batch, chunks: remaining }, { signal: controller.signal });
        if (!valid() || controller.signal.aborted) return;
        // BackgroundApi validates IDs, count, order, and language against this request.
        useReaderStore.getState().applyBatch(operation, response.chunks);
      }
      if (valid()) useReaderStore.getState().finishTranslation(operation);
    } catch (error) {
      if (valid() && !controller.signal.aborted) useReaderStore.getState().failTranslation(operation, feedback(error));
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  dispose(): void {
    this.controller?.abort();
    this.controller = null;
    this.unsubscribe();
  }
}
