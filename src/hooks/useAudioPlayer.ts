import { useEffect, useRef } from 'react';
import { SpeechPlayer, type SpeechEvents } from '../services/speech-player';
import { useReaderStore } from '../stores/reader-store';

export function useAudioPlayer(): { start: () => void; pause: () => void; resume: () => void; stop: () => void } {
  const player = useRef<SpeechPlayer | null>(null);
  if (!player.current) player.current = new SpeechPlayer();
  useEffect(() => {
    const unsubscribe = useReaderStore.subscribe((state, previous) => {
      if (state.sessionId !== previous.sessionId || state.translationOperation !== previous.translationOperation ||
        state.narration !== previous.narration) player.current?.stop();
    });
    return () => { unsubscribe(); player.current?.stop(); };
  }, []);

  const start = (): void => {
    const state = useReaderStore.getState();
    if (!state.document || state.status === 'extracting' || state.status === 'reading' || state.status === 'starting' ||
      state.translationStatus === 'translating' || state.translationStatus === 'awaiting_consent' ||
      (state.narration === 'translated' && (state.translationStatus !== 'ready' ||
        state.document.chunks.some((chunk) => !chunk.translatedText)))) return;
    const sessionId = state.sessionId;
    const operation = state.translationOperation;
    const valid = (): boolean => useReaderStore.getState().sessionId === sessionId &&
      useReaderStore.getState().translationOperation === operation;
    const events: SpeechEvents = {
      onStart: (index) => { if (valid()) useReaderStore.getState().started(index); },
      onPending: (index) => { if (valid()) useReaderStore.getState().pending(index); },
      onComplete: () => { if (valid()) useReaderStore.getState().complete(); },
      onPause: () => { if (valid()) useReaderStore.getState().pause(); },
      onResume: () => { if (valid()) useReaderStore.getState().resume(); },
      onError: (message) => { if (valid()) useReaderStore.getState().fail(message, 'speech'); }
    };
    const from = state.chunkIndex >= state.document.chunks.length ? 0 : state.chunkIndex;
    useReaderStore.getState().pending(from);
    player.current?.start(state.document.chunks, from,
      state.narration === 'translated' ? state.targetLanguage : state.sourceLanguage ?? state.document.language,
      events, state.narration);
  };
  return {
    start,
    pause: () => player.current?.pause(),
    resume: () => {
      const state = useReaderStore.getState();
      if (state.status !== 'paused') return;
      state.pending(state.pendingIndex ?? state.chunkIndex);
      player.current?.resume();
    },
    stop: () => { player.current?.stop(); useReaderStore.getState().stop(); }
  };
}
