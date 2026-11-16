import { describe, expect, it, vi } from 'vitest';
import { SpeechPlayer, type SpeechEvents } from '../src/services/speech-player';

function setup() {
  const utterances: SpeechSynthesisUtterance[] = [];
  const synth = {
    getVoices: () => [],
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn()
  } as unknown as SpeechSynthesis;
  const events: SpeechEvents = {
    onStart: vi.fn(), onPending: vi.fn(), onComplete: vi.fn(), onPause: vi.fn(),
    onResume: vi.fn(), onError: vi.fn()
  };
  const player = new SpeechPlayer(synth, (text) => {
    const utterance = { text } as SpeechSynthesisUtterance;
    utterances.push(utterance);
    return utterance;
  });
  const chunks = [
    { id: '0', index: 0, originalText: 'First.' },
    { id: '1', index: 1, originalText: 'Second.' }
  ];
  return { player, synth, events, chunks, utterances };
}

describe('SpeechPlayer', () => {
  it('starts only when speech starts and reads chunks in order', () => {
    const { player, synth, events, chunks, utterances } = setup();
    player.start(chunks, 0, 'en', events);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(events.onStart).not.toHaveBeenCalled();
    utterances[0].onstart?.({} as SpeechSynthesisEvent);
    expect(events.onStart).toHaveBeenCalledWith(0);
    utterances[0].onend?.({} as SpeechSynthesisEvent);
    expect(events.onPending).toHaveBeenCalledOnce();
    expect(events.onStart).toHaveBeenCalledTimes(1);
    utterances[1].onstart?.({} as SpeechSynthesisEvent);
    utterances[1].onend?.({} as SpeechSynthesisEvent);
    expect(events.onComplete).toHaveBeenCalledOnce();
    player.stop();
  });
  it('cancels stale callbacks on stop', () => {
    const { player, synth, events, chunks, utterances } = setup();
    player.start(chunks, 0, null, events);
    const stale = utterances[0].onend;
    player.stop();
    stale?.call(utterances[0], {} as SpeechSynthesisEvent);
    expect(events.onComplete).not.toHaveBeenCalled();
    expect(synth.cancel).toHaveBeenCalled();
  });
  it('reports synthesis errors', () => {
    const { player, events, chunks, utterances } = setup();
    player.start(chunks, 0, null, events);
    utterances[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);
    expect(events.onError).toHaveBeenCalledWith(expect.stringContaining('synthesis-failed'));
    expect(events.onError).toHaveBeenCalledWith(expect.stringContaining('No voices were reported'));
  });
  it('pauses at a chunk checkpoint without relying on native pause events', () => {
    const { player, synth, events, chunks, utterances } = setup();
    player.start(chunks, 0, null, events);
    utterances[0].onstart?.({} as SpeechSynthesisEvent);
    const stale = utterances[0].onend;
    player.pause();
    expect(events.onPause).toHaveBeenCalledOnce();
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(synth.pause).not.toHaveBeenCalled();
    stale?.call(utterances[0], {} as SpeechSynthesisEvent);
    expect(events.onPending).not.toHaveBeenCalled();
    player.resume();
    expect(utterances[1].text).toBe('First.');
    expect(events.onResume).not.toHaveBeenCalled();
    utterances[1].onstart?.({} as SpeechSynthesisEvent);
    expect(events.onResume).toHaveBeenCalledOnce();
    utterances[1].onend?.({} as SpeechSynthesisEvent);
    expect(events.onPending).toHaveBeenCalledOnce();
    player.stop();
  });
  it('ignores rapid repeated pause and resume until playback actually restarts', () => {
    const { player, events, chunks, utterances } = setup();
    player.start(chunks, 0, null, events);
    utterances[0].onstart?.({} as SpeechSynthesisEvent);
    player.pause();
    player.pause();
    expect(events.onPause).toHaveBeenCalledOnce();
    player.resume();
    player.resume();
    expect(utterances).toHaveLength(2);
    utterances[1].onstart?.({} as SpeechSynthesisEvent);
    expect(events.onResume).toHaveBeenCalledOnce();
    player.stop();
  });
  it('does not restart after Stop while paused', () => {
    const { player, events, chunks, utterances } = setup();
    player.start(chunks, 0, null, events);
    utterances[0].onstart?.({} as SpeechSynthesisEvent);
    player.pause();
    player.stop();
    player.resume();
    expect(utterances).toHaveLength(1);
    expect(events.onResume).not.toHaveBeenCalled();
  });
  it('holds the checkpoint during delayed next start and supports pause and resume while pending', () => {
    const { player, events, chunks, utterances } = setup();
    player.start(chunks, 0, null, events);
    utterances[0].onstart?.({} as SpeechSynthesisEvent);
    utterances[0].onend?.({} as SpeechSynthesisEvent);
    expect(events.onPending).toHaveBeenCalledOnce();
    expect(events.onStart).toHaveBeenCalledTimes(1);
    const stale = utterances[1].onstart;
    player.pause();
    stale?.call(utterances[1], {} as SpeechSynthesisEvent);
    expect(events.onStart).toHaveBeenCalledTimes(1);
    player.resume();
    expect(utterances[2].text).toBe('Second.');
    utterances[2].onstart?.({} as SpeechSynthesisEvent);
    expect(events.onStart).toHaveBeenCalledWith(1);
    player.stop();
  });
  it('times out a pending start and ignores its stale callbacks', () => {
    vi.useFakeTimers();
    try {
      const { player, events, chunks, utterances } = setup();
      player.start(chunks, 0, null, events);
      const stale = utterances[0].onstart;
      vi.advanceTimersByTime(8000);
      stale?.call(utterances[0], {} as SpeechSynthesisEvent);
      expect(events.onError).toHaveBeenCalledOnce();
      expect(events.onStart).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('stops while the next utterance is pending', () => {
    const { player, events, chunks, utterances, synth } = setup();
    player.start(chunks, 0, null, events);
    utterances[0].onstart?.({} as SpeechSynthesisEvent);
    utterances[0].onend?.({} as SpeechSynthesisEvent);
    const stale = utterances[1].onstart;
    player.stop();
    stale?.call(utterances[1], {} as SpeechSynthesisEvent);
    expect(events.onStart).toHaveBeenCalledTimes(1);
    expect(synth.cancel).toHaveBeenCalled();
  });
});
