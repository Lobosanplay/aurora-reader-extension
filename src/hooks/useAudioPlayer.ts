import { useEffect, useRef } from 'react';
import { SpeechPlayer, type SpeechEvents } from '../services/speech-player';
import { useReaderStore } from '../stores/reader-store';

export function useAudioPlayer(): { start: () => void; pause: () => void; resume: () => void; stop: () => void } {
  const player = useRef<SpeechPlayer | null>(null);
  if (!player.current) player.current = new SpeechPlayer();
  useEffect(() => {
    const unsubscribe = useReaderStore.subscribe((state, previous) => {
      if (state.sessionId !== previous.sessionId) player.current?.stop();
    });
    return () => { unsubscribe(); player.current?.stop(); };
  }, []);

  const start = (): void => {
    const state = useReaderStore.getState();
    if (!state.document || state.status === 'extracting' || state.status === 'reading' || state.status === 'starting') return;
    const sessionId = state.sessionId;
    const valid = (): boolean => useReaderStore.getState().sessionId === sessionId;
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
    player.current?.start(state.document.chunks, from, state.document.language, events);
  };
  return {
    start,
    pause: () => player.current?.pause(),
    resume: () => { useReaderStore.getState().pending(useReaderStore.getState().pendingIndex ?? useReaderStore.getState().chunkIndex); player.current?.resume(); },
    stop: () => { player.current?.stop(); useReaderStore.getState().stop(); }
  };
}
