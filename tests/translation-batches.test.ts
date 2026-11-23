import { describe, expect, it } from 'vitest';
import { buildTranslationBatches } from '../src/services/translation-batches';
import { normalizeLanguage } from '../src/services/translation-languages';

const chunks = (count: number, text = 'A sentence.') =>
  Array.from({ length: count }, (_, index) => ({ id: `chunk-${index}`, index, originalText: text }));

describe('translation batches and language tags', () => {
  it('normalizes declared tags without inventing a source', () => {
    expect(normalizeLanguage('ES-mx')).toBe('es-MX');
    expect(normalizeLanguage(' EN ')).toBe('en');
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage('unrecognized-value-here')).toBeNull();
  });
  it('maps text and preserves exact boundaries and order', () => {
    expect(buildTranslationBatches(chunks(1), 'en', 'es')).toEqual([
      { source_language: 'en', target_language: 'es', chunks: [{ id: 'chunk-0', text: 'A sentence.' }] }
    ]);
    const batches = buildTranslationBatches(chunks(41), 'en', 'es');
    expect(batches.map((batch) => batch.chunks.length)).toEqual([20, 20, 1]);
    expect(batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.id)))
      .toEqual(chunks(41).map((chunk) => chunk.id));
    expect(buildTranslationBatches(chunks(20), 'es', 'en')).toHaveLength(1);
  });
  it('respects total character and UTF-8 body limits', () => {
    expect(buildTranslationBatches(chunks(11, 'x'.repeat(2000)), 'en', 'es').map((batch) => batch.chunks.length))
      .toEqual([10, 1]);
    expect(buildTranslationBatches(chunks(20, '🌊'.repeat(1000)), 'en', 'es').map((batch) => batch.chunks.length))
      .toEqual([10, 10]);
    expect(buildTranslationBatches(chunks(20, '\u0001'.repeat(1000)), 'en', 'es').length).toBeGreaterThan(1);
  });
  it('rejects oversized passages and invalid identifiers before transmission', () => {
    expect(() => buildTranslationBatches(chunks(1, 'x'.repeat(4001)), 'en', 'es')).toThrow();
    expect(() => buildTranslationBatches([{ id: 'bad id', index: 0, originalText: 'Text' }], 'en', 'es')).toThrow();
  });
});
