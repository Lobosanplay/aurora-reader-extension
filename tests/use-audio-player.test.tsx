import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioPlayer } from '../src/hooks/useAudioPlayer';
import { useReaderStore } from '../src/stores/reader-store';

class MockUtterance {
  text: string;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
  onpause: ((event: SpeechSynthesisEvent) => void) | null = null;
  onresume: ((event: SpeechSynthesisEvent) => void) | null = null;

  constructor(text: string) { this.text = text; }
}

const article = {
  url: 'https://example.com/article',
  title: 'Article',
  language: 'en',
  chunks: [
    { id: 'one', index: 0, originalText: 'First passage.' },
    { id: 'two', index: 1, originalText: 'Second passage.' }
  ]
};

describe('useAudioPlayer lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let spoken: MockUtterance[];
  let synth: SpeechSynthesis;
  let controls: ReturnType<typeof useAudioPlayer> | null;
  let mounted: boolean;

  beforeEach(() => {
    spoken = [];
    controls = null;
    mounted = true;
    synth = {
      getVoices: () => [],
      speak: vi.fn((utterance: MockUtterance) => { spoken.push(utterance); }),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn()
    } as unknown as SpeechSynthesis;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => {
      root.render(<PlayerHarness onReady={(player) => { controls = player; }} />);
    });
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument(article);
  });

  afterEach(() => {
    if (mounted) flushSync(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('supports Play → Stop and ignores stale speech completion', () => {
    controls?.start();
    const staleEnd = spoken[0].onend;
    controls?.stop();
    staleEnd?.({} as SpeechSynthesisEvent);

    expect(useReaderStore.getState()).toMatchObject({ status: 'idle', chunkIndex: 0 });
    expect(synth.cancel).toHaveBeenCalled();
    expect(useReaderStore.getState().status).not.toBe('reading');
  });

  it('supports Play → Pause → Resume and keeps progress at the confirmed chunk', () => {
    controls?.start();
    spoken[0].onstart?.({} as SpeechSynthesisEvent);
    controls?.pause();
    expect(useReaderStore.getState()).toMatchObject({ status: 'paused', chunkIndex: 0 });

    controls?.resume();
    expect(useReaderStore.getState().status).toBe('starting');
    expect(spoken[1].text).toBe('First passage.');
    spoken[1].onstart?.({} as SpeechSynthesisEvent);
    expect(useReaderStore.getState()).toMatchObject({ status: 'reading', chunkIndex: 0 });
  });

  it('allows Play → Stop → Play without an old job changing current progress', () => {
    controls?.start();
    const staleEnd = spoken[0].onend;
    controls?.stop();
    controls?.start();
    spoken[1].onstart?.({} as SpeechSynthesisEvent);
    staleEnd?.({} as SpeechSynthesisEvent);

    expect(useReaderStore.getState()).toMatchObject({ status: 'reading', chunkIndex: 0 });
    expect(spoken).toHaveLength(2);
  });

  it('supports Play → Pause → Stop and does not permit a later resume', () => {
    controls?.start();
    spoken[0].onstart?.({} as SpeechSynthesisEvent);
    controls?.pause();
    controls?.stop();
    controls?.resume();

    expect(spoken).toHaveLength(1);
    expect(useReaderStore.getState()).toMatchObject({ status: 'idle', chunkIndex: 0 });
  });

  it('cancels speech and detaches listeners when the widget unmounts', () => {
    controls?.start();
    const staleStart = spoken[0].onstart;
    flushSync(() => root.unmount());
    mounted = false;
    staleStart?.({} as SpeechSynthesisEvent);

    expect(synth.cancel).toHaveBeenCalled();
    expect(useReaderStore.getState().status).not.toBe('reading');
  });

  it('invalidates playback after navigation', () => {
    controls?.start();
    const staleStart = spoken[0].onstart;
    useReaderStore.getState().beginExtraction();
    staleStart?.({} as SpeechSynthesisEvent);

    expect(synth.cancel).toHaveBeenCalled();
    expect(useReaderStore.getState()).toMatchObject({ status: 'extracting', document: null });
  });

  it('invalidates playback after article replacement', () => {
    controls?.start();
    spoken[0].onstart?.({} as SpeechSynthesisEvent);
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument({ ...article, title: 'Replacement' });

    expect(synth.cancel).toHaveBeenCalled();
    expect(useReaderStore.getState()).toMatchObject({ status: 'idle', document: { title: 'Replacement' } });
  });

  it('ignores rapid duplicate starts, pause/resume commands and delayed starts', () => {
    controls?.start();
    controls?.start();
    expect(spoken).toHaveLength(1);
    controls?.pause();
    controls?.pause();
    controls?.resume();
    controls?.resume();
    expect(spoken).toHaveLength(2);
    spoken[0].onstart?.({} as SpeechSynthesisEvent);
    expect(useReaderStore.getState().status).toBe('starting');
    spoken[1].onstart?.({} as SpeechSynthesisEvent);
    expect(useReaderStore.getState().status).toBe('reading');
  });

  it('reports synthesis failure and does not leave playback marked active', () => {
    controls?.start();
    spoken[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);

    expect(useReaderStore.getState()).toMatchObject({ status: 'error', errorSource: 'speech' });
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('narrates only translated text in the target language and preserves pause/resume', () => {
    useReaderStore.getState().setTargetLanguage('es');
    useReaderStore.getState().requestConsent();
    useReaderStore.getState().authorizeTranslation();
    const operation = useReaderStore.getState().translationOperation;
    useReaderStore.getState().beginTranslation(operation);
    useReaderStore.getState().applyBatch(operation, [
      { id: 'one', text: 'Primer fragmento.' }, { id: 'two', text: 'Segundo fragmento.' }
    ]);
    useReaderStore.getState().finishTranslation(operation);
    controls?.start();
    controls?.start();
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatchObject({ text: 'Primer fragmento.', lang: 'es' });
    spoken[0].onstart?.({} as SpeechSynthesisEvent);
    controls?.pause();
    controls?.resume();
    expect(spoken[1]).toMatchObject({ text: 'Primer fragmento.', lang: 'es' });
    spoken[1].onstart?.({} as SpeechSynthesisEvent);
    spoken[1].onend?.({} as SpeechSynthesisEvent);
    expect(spoken[2]).toMatchObject({ text: 'Segundo fragmento.', lang: 'es' });
    controls?.stop();
    expect(useReaderStore.getState()).toMatchObject({ status: 'idle', chunkIndex: 0 });
  });

  it('keeps original reading local and never mixes translated chunks after changing language', () => {
    useReaderStore.getState().setTargetLanguage('es');
    useReaderStore.getState().requestConsent();
    useReaderStore.getState().declineConsent();
    controls?.start();
    expect(spoken[0]).toMatchObject({ text: 'First passage.', lang: 'en' });
    const oldStart = spoken[0].onstart;
    useReaderStore.getState().setTargetLanguage('en');
    oldStart?.({} as SpeechSynthesisEvent);
    expect(useReaderStore.getState().status).not.toBe('reading');
    expect(synth.cancel).toHaveBeenCalled();
  });
});

function PlayerHarness({ onReady }: { onReady: (player: ReturnType<typeof useAudioPlayer>) => void }): React.JSX.Element {
  const player = useAudioPlayer();
  onReady(player);
  return <div />;
}
