import type { TextChunk } from '../types';

export function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

const abbreviations = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e']);

function sentences(text: string): { value: string; spaceBefore: boolean }[] {
  const parts: { value: string; spaceBefore: boolean }[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const mark = text[index];
    if (!'.!?。！？'.includes(mark)) continue;
    if (mark === '.') {
      if (/\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[index + 1] ?? '')) continue;
      const word = text.slice(start, index).match(/(?:\p{L}\.)*\p{L}+$/u)?.[0].toLowerCase();
      if (word && abbreviations.has(word)) continue;
    }
    let end = index + 1;
    while (/[.!?。！？"”’')\]]/u.test(text[end] ?? '') && end < text.length) end++;
    if (end < text.length && !/\s/u.test(text[end]) && !'。！？'.includes(mark)) continue;
    parts.push({ value: text.slice(start, end).trim(), spaceBefore: /\s/u.test(text[start] ?? '') });
    start = end;
    index = end - 1;
  }
  if (text.slice(start).trim()) parts.push({ value: text.slice(start).trim(), spaceBefore: /\s/u.test(text[start] ?? '') });
  return parts.filter((part) => part.value);
}

function bounded(sentence: string, maxLength: number): string[] {
  const result: string[] = [];
  let remaining = sentence;
  while (remaining.length > maxLength) {
    // Prefer word boundaries; an indivisible word is allowed to exceed the target.
    let cut = remaining.lastIndexOf(' ', maxLength);
    if (cut <= 0) {
      cut = remaining.indexOf(' ', maxLength);
      if (cut < 0) break;
    }
    result.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut + 1);
  }
  if (remaining) result.push(remaining);
  return result;
}

export function chunkText(blocks: string[], maxLength = 520): TextChunk[] {
  const results: string[] = [];
  let current = '';
  const flush = (): void => { if (current) results.push(current); current = ''; };
  for (const block of blocks) {
    const clean = normalizeText(block);
    if (!clean) continue;
    for (const sentence of sentences(clean)) {
      for (const [index, part] of bounded(sentence.value, maxLength).entries()) {
        const separator = index > 0 || sentence.spaceBefore ? ' ' : '';
        if (current && current.length + part.length + separator.length > maxLength) flush();
        current = current ? `${current}${separator}${part}` : part;
      }
    }
    flush(); // Keep paragraph boundaries as checkpoints.
  }
  return results.map((originalText, index) => ({ id: `chunk-${index}`, index, originalText }));
}
