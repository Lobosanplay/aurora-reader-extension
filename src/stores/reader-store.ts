import { create } from 'zustand';
import type { AssistantState, PageContent } from '../types';
import { normalizeLanguage } from '../services/translation-languages';
import type { TextChunk } from '../types';

const originals = (chunks: TextChunk[]): TextChunk[] =>
  chunks.map(({ id, index, originalText }) => ({ id, index, originalText }));

type TranslationStatus = 'idle' | 'awaiting_consent' | 'translating' | 'ready' | 'error' | 'cancelled';

interface ReaderStore {
  status: AssistantState;
  document: PageContent | null;
  chunkIndex: number;
  pendingIndex: number | null;
  sessionId: number;
  error: string | null;
  errorSource: 'extraction' | 'speech' | null;
  sourceLanguage: string | null;
  targetLanguage: string;
  translationStatus: TranslationStatus;
  translationError: string | null;
  translationOperation: number;
  translatedCount: number;
  consentSession: number | null;
  narration: 'original' | 'translated';
  setSourceLanguage: (language: string) => void;
  setTargetLanguage: (language: string) => void;
  requestConsent: () => void;
  declineConsent: () => void;
  authorizeTranslation: () => void;
  beginTranslation: (operation: number) => void;
  applyBatch: (operation: number, translations: { id: string; text: string }[]) => void;
  finishTranslation: (operation: number) => void;
  failTranslation: (operation: number, message: string) => void;
  readOriginal: () => void;
  readTranslated: () => void;
  beginExtraction: () => void;
  setDocument: (document: PageContent) => void;
  fail: (message: string, source: 'extraction' | 'speech') => void;
  started: (index: number) => void;
  pending: (index: number) => void;
  pause: () => void;
  resume: () => void;
  complete: () => void;
  stop: () => void;
}

export const useReaderStore = create<ReaderStore>((set) => ({
  status: 'idle', document: null, chunkIndex: 0, pendingIndex: null, sessionId: 0, error: null, errorSource: null,
  sourceLanguage: null, targetLanguage: 'en', translationStatus: 'idle', translationError: null,
  translationOperation: 0, translatedCount: 0, consentSession: null, narration: 'original',
  beginExtraction: () => set((state) => ({
    status: 'extracting', document: null, chunkIndex: 0, pendingIndex: null, sessionId: state.sessionId + 1,
    translationOperation: state.translationOperation + 1, translationStatus: 'idle', translationError: null,
    translatedCount: 0, consentSession: null, narration: 'original', sourceLanguage: null, error: null, errorSource: null
  })),
  setDocument: (document) => set((state) => state.status === 'extracting'
    ? { document: { ...document, chunks: originals(document.chunks) },
      sourceLanguage: normalizeLanguage(document.language), status: 'idle', error: null, errorSource: null } : state),
  setSourceLanguage: (language) => set((state) => ({
    sourceLanguage: language, translationOperation: state.translationOperation + 1, translationStatus: 'idle',
    translationError: null, translatedCount: 0, consentSession: null, narration: 'original', chunkIndex: 0,
    pendingIndex: null, document: state.document && { ...state.document,
      chunks: originals(state.document.chunks) }
  })),
  setTargetLanguage: (language) => set((state) => ({
    targetLanguage: language, translationOperation: state.translationOperation + 1, translationStatus: 'idle',
    translationError: null, translatedCount: 0, consentSession: null, narration: 'original', chunkIndex: 0,
    pendingIndex: null, document: state.document && { ...state.document,
      chunks: originals(state.document.chunks) }
  })),
  requestConsent: () => set((state) => state.document && state.sourceLanguage &&
    state.sourceLanguage !== state.targetLanguage && state.translationStatus !== 'translating'
    ? { translationStatus: 'awaiting_consent', translationError: null } : state),
  declineConsent: () => set((state) => ({
    translationStatus: 'cancelled', consentSession: null, translationOperation: state.translationOperation + 1
  })),
  authorizeTranslation: () => set((state) => state.translationStatus === 'awaiting_consent' && state.document
    ? { consentSession: state.sessionId, translationStatus: 'idle' } : state),
  beginTranslation: (operation) => set((state) => state.document && state.consentSession === state.sessionId &&
    state.translationOperation === operation ? { translationStatus: 'translating', translationError: null } : state),
  applyBatch: (operation, translations) => set((state) => {
    if (!state.document || state.translationOperation !== operation || state.translationStatus !== 'translating' ||
      state.consentSession !== state.sessionId) return state;
    const translated = new Map(translations.map((chunk) => [chunk.id, chunk.text]));
    const chunks = state.document.chunks.map((chunk) =>
      translated.has(chunk.id) ? { ...chunk, translatedText: translated.get(chunk.id) } : chunk);
    return { document: { ...state.document, chunks }, translatedCount: chunks.filter((chunk) => chunk.translatedText !== undefined).length };
  }),
  finishTranslation: (operation) => set((state) => state.translationOperation === operation &&
    state.translationStatus === 'translating' && state.translatedCount === state.document?.chunks.length
    ? { translationStatus: 'ready', narration: 'translated', chunkIndex: 0, pendingIndex: null } : state),
  failTranslation: (operation, message) => set((state) => state.translationOperation === operation &&
    state.translationStatus === 'translating' ? { translationStatus: 'error', translationError: message } : state),
  readOriginal: () => set({ narration: 'original', chunkIndex: 0, pendingIndex: null }),
  readTranslated: () => set((state) => state.translationStatus === 'ready'
    ? { narration: 'translated', chunkIndex: 0, pendingIndex: null } : state),
  fail: (message, source) => set({ status: 'error', pendingIndex: null, error: message, errorSource: source }),
  pending: (index) => set((state) => state.document && (state.status === 'idle' || state.status === 'reading' || state.status === 'paused' || state.status === 'error')
    ? { status: 'starting', pendingIndex: index, error: null, errorSource: null } : state),
  started: (index) => set((state) => state.document && (state.status === 'starting' || state.status === 'idle' || state.status === 'paused' || state.status === 'error')
    ? { status: 'reading', chunkIndex: index, pendingIndex: null, error: null, errorSource: null } : state),
  pause: () => set((state) => state.status === 'reading' || state.status === 'starting' ? { status: 'paused' } : state),
  resume: () => set((state) => state.status === 'starting' ? { status: 'reading' } : state),
  complete: () => set((state) => state.status === 'reading' || state.status === 'starting'
    ? { status: 'idle', pendingIndex: null, chunkIndex: state.document?.chunks.length ?? 0 } : state),
  stop: () => set((state) => ({ status: state.document ? 'idle' : 'error', chunkIndex: 0,
    translationOperation: state.translationOperation + 1, translationStatus: state.translationStatus === 'translating' ? 'cancelled' : state.translationStatus,
    consentSession: null,
    pendingIndex: null, error: state.document ? null : state.error, errorSource: state.document ? null : state.errorSource }))
}));
