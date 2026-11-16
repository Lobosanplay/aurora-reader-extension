import { describe, expect, it } from 'vitest';
import { chunkText, normalizeText } from '../src/utils/chunk-text';

describe('text handling', () => {
  it('normalizes spacing without removing punctuation', () => {
    expect(normalizeText('  Hello,\n  world.   Next sentence! ')).toBe('Hello, world. Next sentence!');
  });
  it('preserves sentence endings and paragraph order at checkpoints', () => {
    const chunks = chunkText(['First sentence. Second sentence! Third sentence?', 'A second paragraph.'], 34);
    expect(chunks.map((chunk) => chunk.originalText)).toEqual([
      'First sentence. Second sentence!', 'Third sentence?', 'A second paragraph.'
    ]);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
  });
  it('breaks a long sentence at spaces without losing or repeating words', () => {
    const source = 'One continuous sentence with a long ending.';
    const chunks = chunkText([source], 12);
    expect(chunks.map((chunk) => chunk.originalText).join(' ')).toBe(source);
    expect(chunks.every((chunk) => chunk.originalText.length <= 12)).toBe(true);
  });
  it('keeps abbreviations and decimals together while splitting lowercase and multilingual sentences', () => {
    const samples = ['Dr. Smith wrote the article. next sentence.', 'The value is 3.14. another value.',
      '¿Cómo estás? ¡Muy bien!', '第一句。第二句。', 'Unicode café. mañana llega.'];
    for (const sample of samples) {
      const result = chunkText([sample], 35).map((chunk) => chunk.originalText);
      expect(result.join(' ').replace(/。 /gu, '。')).toBe(normalizeText(sample));
      expect(result.some((part) => part === 'Dr.')).toBe(false);
      expect(result.some((part) => part === 'The value is 3.')).toBe(false);
    }
    expect(chunkText(['第一句。第二句。'], 8).map((chunk) => chunk.originalText)).toEqual(['第一句。第二句。']);
  });
  it('keeps normalized text and paragraph order with unpunctuated prose', () => {
    const blocks = ['  alpha   beta gamma delta epsilon zeta eta theta  ', '  àlpha   日本語   final.  '];
    const result = chunkText(blocks, 14);
    expect(result.map((chunk) => chunk.originalText).join(' ')).toBe(blocks.map(normalizeText).join(' '));
    expect(result.map((chunk) => chunk.index)).toEqual(result.map((_, index) => index));
  });
});
