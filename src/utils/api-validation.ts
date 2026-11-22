import type { HealthResponse, QuestionRequest, QuestionResponse, TranscriptionResponse, TranslationRequest, TranslationResponse } from '../types/api';
import { ApiClientError } from '../services/api-errors';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const shape = (value: unknown, keys: string[], optional: string[] = []): value is Record<string, unknown> =>
  record(value) && keys.every((key) => key in value) &&
  Object.keys(value).every((key) => keys.includes(key) || optional.includes(key));
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const language = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value);
const invalid = (): never => { throw new ApiClientError('validation', 'Invalid API request.'); };
const malformed = (): never => { throw new ApiClientError('malformed_response', 'The server returned an invalid response.'); };
const chunk = (value: unknown): value is { id: string; text: string } =>
  shape(value, ['id', 'text']) && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.id) && text(value.text, 4000);

export function validateTranslationRequest(value: unknown): asserts value is TranslationRequest {
  if (!shape(value, ['source_language', 'target_language', 'chunks']) ||
    !language(value.source_language) || !language(value.target_language) ||
    !Array.isArray(value.chunks) || value.chunks.length < 1 || value.chunks.length > 20 ||
    !value.chunks.every(chunk) ||
    new Set(value.chunks.map((item: { id: string }) => item.id)).size !== value.chunks.length ||
    value.chunks.reduce((sum: number, item: { text: string }) => sum + item.text.length, 0) > 20000) return invalid();
}

export function validateQuestionRequest(value: unknown): asserts value is QuestionRequest {
  if (!shape(value, ['question', 'language', 'context']) || !text(value.question, 1000) ||
    !language(value.language) || !shape(value.context, [], ['title', 'current_chunk', 'related_chunks'])) return invalid();
  const context = value.context;
  if ((context.title !== undefined && (typeof context.title !== 'string' || context.title.length > 500)) ||
    (context.current_chunk !== undefined && typeof context.current_chunk !== 'string') ||
    (context.related_chunks !== undefined && (!Array.isArray(context.related_chunks) ||
      context.related_chunks.length > 5 || !context.related_chunks.every((item: unknown) => typeof item === 'string'))) ||
    (context.title as string ?? '').length + (context.current_chunk as string ?? '').length +
      ((context.related_chunks as string[] | undefined) ?? []).reduce((n, item) => n + item.length, 0) > 12000) return invalid();
}

export function validateTranslationResponse(value: unknown, request: TranslationRequest): TranslationResponse {
  if (!shape(value, ['source_language', 'target_language', 'chunks']) ||
    value.source_language !== request.source_language || value.target_language !== request.target_language ||
    !Array.isArray(value.chunks) || value.chunks.length !== request.chunks.length ||
    !value.chunks.every((item, index) => chunk(item) && item.id === request.chunks[index].id) ||
    value.chunks.reduce((sum: number, item: { text: string }) => sum + item.text.length, 0) > 20000) return malformed();
  return value as unknown as TranslationResponse;
}

export function validateQuestionResponse(value: unknown, request: QuestionRequest): QuestionResponse {
  if (!shape(value, ['answer', 'source', 'context_sufficient']) || !text(value.answer, 2000) ||
    !['page', 'general', 'insufficient'].includes(value.source as string) ||
    typeof value.context_sufficient !== 'boolean' ||
    value.context_sufficient !== (value.source === 'page') ||
    (value.source === 'page' && !([request.context.current_chunk, ...(request.context.related_chunks ?? [])].some((item) => item?.trim())))) return malformed();
  return value as unknown as QuestionResponse;
}

export function validateTranscriptionResponse(value: unknown): TranscriptionResponse {
  if (!shape(value, ['text'], ['language']) || !text(value.text, 4000) ||
    (value.language !== undefined && value.language !== null && !language(value.language))) return malformed();
  return { text: value.text as string, language: (value.language ?? null) as string | null };
}

export function validateHealthResponse(value: unknown): HealthResponse {
  if (!shape(value, ['status']) || value.status !== 'ok') return malformed();
  return { status: 'ok' };
}
