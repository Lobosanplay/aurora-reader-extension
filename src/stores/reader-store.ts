import { create } from 'zustand';
import type { AssistantState, PageContent } from '../types';

interface ReaderStore {
  status: AssistantState;
  document: PageContent | null;
  chunkIndex: number;
  pendingIndex: number | null;
  sessionId: number;
  error: string | null;
  errorSource: 'extraction' | 'speech' | null;
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
  beginExtraction: () => set((state) => ({ status: 'extracting', document: null, chunkIndex: 0, pendingIndex: null, sessionId: state.sessionId + 1, error: null, errorSource: null })),
  setDocument: (document) => set((state) => state.status === 'extracting' ? { document, status: 'idle', error: null, errorSource: null } : state),
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
    pendingIndex: null, error: state.document ? null : state.error, errorSource: state.document ? null : state.errorSource }))
}));
