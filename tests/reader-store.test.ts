import { describe, expect, it } from 'vitest';
import { useReaderStore } from '../src/stores/reader-store';

const documentContent = {
  url: 'https://example.com/article', title: 'Article', language: 'en',
  chunks: [{ id: 'chunk-0', index: 0, originalText: 'First.' }, { id: 'chunk-1', index: 1, originalText: 'Second.' }]
};

describe('reader transitions', () => {
  it('only reads a document after extraction and keeps a chunk checkpoint', () => {
    const store = useReaderStore.getState();
    store.beginExtraction();
    useReaderStore.getState().started(0);
    expect(useReaderStore.getState().status).toBe('extracting');
    useReaderStore.getState().setDocument(documentContent);
    useReaderStore.getState().started(0);
    useReaderStore.getState().pending(1);
    expect(useReaderStore.getState()).toMatchObject({ status: 'starting', chunkIndex: 0, pendingIndex: 1 });
    useReaderStore.getState().started(1);
    useReaderStore.getState().pause();
    expect(useReaderStore.getState()).toMatchObject({ status: 'paused', chunkIndex: 1 });
    useReaderStore.getState().resume();
    useReaderStore.getState().stop();
    expect(useReaderStore.getState()).toMatchObject({ status: 'idle', chunkIndex: 0 });
  });
  it('invalidates old sessions during re-extraction', () => {
    const before = useReaderStore.getState().sessionId;
    useReaderStore.getState().beginExtraction();
    expect(useReaderStore.getState().sessionId).toBe(before + 1);
    expect(useReaderStore.getState().document).toBeNull();
  });
  it('can retry narration after a speech failure', () => {
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(documentContent);
    useReaderStore.getState().fail('Speech unavailable', 'speech');
    expect(useReaderStore.getState()).toMatchObject({ status: 'error', errorSource: 'speech', document: documentContent });
    useReaderStore.getState().started(0);
    expect(useReaderStore.getState()).toMatchObject({ status: 'reading', error: null });
  });
  it('keeps confirmed progress separate from a queued passage across pause and resume', () => {
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(documentContent);
    useReaderStore.getState().started(0);
    useReaderStore.getState().pending(1);
    useReaderStore.getState().pause();
    expect(useReaderStore.getState()).toMatchObject({ status: 'paused', chunkIndex: 0, pendingIndex: 1 });
    useReaderStore.getState().pending(1);
    useReaderStore.getState().started(1);
    useReaderStore.getState().resume();
    expect(useReaderStore.getState()).toMatchObject({ status: 'reading', chunkIndex: 1, pendingIndex: null });
  });
});
