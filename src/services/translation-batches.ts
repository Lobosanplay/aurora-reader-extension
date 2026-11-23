import type { TextChunk } from '../types';
import type { TranslationRequest } from '../types/api';
import { ApiClientError } from './api-errors';
import { validateTranslationRequest } from '../utils/api-validation';

// Below the server's 20/4000/20000/100000-byte defaults. JSON is checked
// explicitly because non-ASCII input and escaping can exceed its byte cap.
const MAX_CHUNKS = 20;
const MAX_CHARS = 20_000;
const MAX_BYTES = 100_000;

export function buildTranslationBatches(chunks: TextChunk[], source: string, target: string): TranslationRequest[] {
  const encoder = new TextEncoder();
  const batches: TranslationRequest[] = [];
  let current: TranslationRequest = { source_language: source, target_language: target, chunks: [] };
  const flush = (): void => {
    if (current.chunks.length) batches.push(current);
    current = { source_language: source, target_language: target, chunks: [] };
  };
  for (const item of chunks) {
    const entry = { id: item.id, text: item.originalText };
    const fits = (request: TranslationRequest): boolean =>
      request.chunks.length <= MAX_CHUNKS &&
      request.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) <= MAX_CHARS &&
      encoder.encode(JSON.stringify(request)).length <= MAX_BYTES;
    if (!fits({ ...current, chunks: [...current.chunks, entry] })) flush();
    const candidate = { ...current, chunks: [...current.chunks, entry] };
    if (!fits(candidate)) throw new ApiClientError('validation', 'A passage is too large to translate. Read the original text instead.');
    validateTranslationRequest(candidate);
    current = candidate;
  }
  flush();
  return batches;
}
