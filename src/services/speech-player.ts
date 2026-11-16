import type { TextChunk } from '../types';

export interface SpeechEvents {
  onStart: (index: number) => void;
  onPending: (index: number) => void;
  onComplete: () => void;
  onPause: () => void;
  onResume: () => void;
  onError: (message: string) => void;
}

export class SpeechPlayer {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private utterance: SpeechSynthesisUtterance | null = null;
  private active = false;
  private paused = false;
  private events: SpeechEvents | null = null;
  private chunks: TextChunk[] = [];
  private language: string | null = null;
  private checkpoint = 0;

  constructor(private readonly synth: SpeechSynthesis = window.speechSynthesis,
    private readonly makeUtterance: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text)) {}

  start(chunks: TextChunk[], from: number, language: string | null, events: SpeechEvents): void {
    this.play(chunks, from, language, events, false);
  }

  private play(chunks: TextChunk[], from: number, language: string | null, events: SpeechEvents, resuming: boolean): void {
    this.stop();
    if (!this.synth || typeof this.synth.speak !== 'function') {
      events.onError('Speech playback is unavailable in this browser.');
      return;
    }
    if (from >= chunks.length || !chunks.length) {
      events.onError('There is no text to read.');
      return;
    }
    const token = this.generation;
    this.active = true;
    this.events = events;
    this.chunks = chunks;
    this.language = language;
    this.checkpoint = from;
    const speak = (index: number): void => {
      if (token !== this.generation) return;
      if (index >= chunks.length) { this.active = false; events.onComplete(); return; }
      if (!chunks[index].originalText.trim()) { speak(index + 1); return; }
      this.checkpoint = index;
      try {
        const utterance = this.makeUtterance(chunks[index].translatedText || chunks[index].originalText);
        this.utterance = utterance;
        const voices = this.synth.getVoices();
        const match = language && voices.find((voice) => voice.lang.toLowerCase() === language.toLowerCase())
          || language && voices.find((voice) => voice.lang.toLowerCase().startsWith(language.toLowerCase().split('-')[0]));
        if (match) utterance.voice = match;
        if (language) utterance.lang = language;
        utterance.onstart = () => {
          if (token !== this.generation) return;
          this.clearTimer();
          events.onStart(index);
          if (resuming) { resuming = false; events.onResume(); }
        };
        utterance.onend = () => {
          if (token !== this.generation) return;
          this.clearTimer();
          this.utterance = null;
          this.checkpoint = index + 1;
          if (index + 1 < chunks.length) events.onPending(index + 1);
          speak(index + 1);
        };
        utterance.onerror = (event) => {
          if (token !== this.generation) return;
          const message = event.error === 'synthesis-failed'
            ? `Browser speech engine failed (synthesis-failed). ${voices.length ? 'Check browser audio and installed voices, then retry.' : 'No voices were reported. Check that your browser has a working speech voice installed.'}`
            : event.error === 'language-unavailable' || event.error === 'voice-unavailable'
              ? 'No voice is available for this page language. Install a compatible browser voice and try again.'
              : event.error === 'not-allowed'
                ? 'Speech was blocked. Click Start reading again to allow playback.'
                : `Speech playback failed (${event.error}). Check browser audio and try again.`;
          this.stop();
          events.onError(message);
        };
        this.timer = setTimeout(() => {
          if (token === this.generation) {
            this.stop();
            events.onError('Speech did not start. Check browser audio and available voices, then retry.');
          }
        }, 8000);
        this.synth.speak(utterance);
      } catch {
        this.stop();
        events.onError('Speech playback is unavailable in this browser.');
      }
    };
    speak(from);
  }

  pause(): void {
    if (this.active && !this.paused) {
      const events = this.events;
      this.generation++;
      this.clearTimer();
      this.detachUtterance();
      this.active = false;
      this.paused = true;
      try {
        // Native pause events/flags are unreliable in Chromium. A canceled utterance
        // gives us a dependable chunk checkpoint without claiming word-level resume.
        this.synth.cancel();
        events?.onPause();
      } catch {
        this.stop();
        events?.onError('This browser could not pause speech. Try starting again.');
      }
    }
  }

  resume(): void {
    if (!this.paused || !this.events) return;
    this.play(this.chunks, this.checkpoint, this.language, this.events, true);
  }

  stop(): void {
    const shouldCancel = this.active || this.utterance !== null;
    this.generation++;
    this.clearTimer();
    this.active = false;
    this.paused = false;
    this.events = null;
    this.chunks = [];
    this.language = null;
    this.checkpoint = 0;
    this.detachUtterance();
    if (shouldCancel) this.synth?.cancel();
  }

  private detachUtterance(): void {
    if (!this.utterance) return;
    this.utterance.onstart = this.utterance.onend = this.utterance.onerror = null;
    this.utterance.onpause = this.utterance.onresume = null;
    this.utterance = null;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
