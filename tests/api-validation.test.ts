import { describe, expect, it } from 'vitest';
import { validateTranslationRequest, validateTranslationResponse, validateQuestionResponse } from '../src/utils/api-validation';

const request = { source_language: 'en', target_language: 'es', chunks: [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'World' }] };
describe('wire validation', () => {
  it('accepts ordered chunks and rejects duplicate IDs', () => {
    expect(() => validateTranslationRequest(request)).not.toThrow();
    expect(() => validateTranslationRequest({ ...request, chunks: [request.chunks[0], request.chunks[0]] })).toThrow();
  });
  it('rejects missing, swapped and malformed translations', () => {
    for (const chunks of [[{ id: 'a', text: 'Hola' }], [...request.chunks].reverse(), [{ id: 'a', text: '' }, request.chunks[1]]]) {
      expect(() => validateTranslationResponse({ ...request, chunks }, request)).toThrow();
    }
  });
  it('does not accept invented answer sources or page claims without excerpts', () => {
    const q = { question: 'Why?', language: 'en', context: {} };
    expect(() => validateQuestionResponse({ answer: 'Yes', source: 'external', context_sufficient: false }, q)).toThrow();
    expect(() => validateQuestionResponse({ answer: 'Yes', source: 'page', context_sufficient: true }, q)).toThrow();
  });
});
