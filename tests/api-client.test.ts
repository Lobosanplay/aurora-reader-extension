import { describe, expect, it, vi } from 'vitest';
import { AuroraApiClient, resolveApiOrigin } from '../src/services/api-client';
import { ApiClientError } from '../src/services/api-errors';

const translation = { source_language: 'en', target_language: 'es', chunks: [{ id: 'one', text: 'Hello' }] };
const question = { question: 'What?', language: 'en', context: { current_chunk: 'An excerpt' } };
const mock = (body: unknown, status = 200, headers?: HeadersInit) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));
const client = (fetcher: typeof fetch) => new AuroraApiClient('https://api.example.com', fetcher);

describe('API transport', () => {
  it('uses the configured origin, JSON and no credentials', async () => {
    const fetcher = mock(translation);
    expect(await client(fetcher).translate(translation)).toEqual(translation);
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/api/v1/translate', expect.objectContaining({
      method: 'POST', credentials: 'omit', body: JSON.stringify(translation), headers: { 'Content-Type': 'application/json' }
    }));
    expect(await client(mock({ status: 'ok' })).health()).toEqual({ status: 'ok' });
    expect(await client(mock({ answer: 'Yes', source: 'page', context_sufficient: true })).ask(question)).toMatchObject({ answer: 'Yes' });
  });
  it('uploads multipart WAV without setting a boundary', async () => {
    const fetcher = mock({ text: 'Hello', language: null });
    const audio = new Blob(['RIFF'], { type: 'audio/wav' });
    expect(await client(fetcher).transcribe(audio, { language: 'en' })).toEqual({ text: 'Hello', language: null });
    const init = fetcher.mock.calls[0][1]!;
    expect(init.headers).toBeUndefined();
    expect((init.body as FormData).get('language')).toBe('en');
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });
  it.each([
    [422, 'INVALID_INPUT', 'validation'], [401, 'UNAUTHORIZED', 'unauthorized'],
    [403, 'FORBIDDEN', 'unauthorized'], [429, 'RATE_LIMITED', 'rate_limited'],
    [502, 'PROVIDER_FAILURE', 'provider_failure'], [503, 'PROVIDER_UNAVAILABLE', 'provider_unavailable'],
    [504, 'PROVIDER_TIMEOUT', 'provider_timeout']
  ] as const)('maps HTTP %i errors', async (status, code, category) => {
    try {
      await client(mock({ error: { code, message: 'secret details', request_id: 'opaque' } }, status, { 'Retry-After': '12' })).health();
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toMatchObject({ category, requestId: 'opaque', retryAfter: '12', status });
      expect((error as Error).message).not.toContain('secret');
    }
  });
  it('sanitizes unknown errors while retaining a header request ID', async () => {
    await expect(client(mock({ detail: 'secret' }, 500, { 'X-Request-ID': 'header-id' })).health())
      .rejects.toMatchObject({ category: 'unavailable', requestId: 'header-id' });
  });
  it('rejects invalid JSON, malformed data and mismatched chunks', async () => {
    await expect(client(vi.fn<typeof fetch>().mockResolvedValue(new Response('{'))).health())
      .rejects.toMatchObject({ category: 'malformed_response' });
    await expect(client(mock({ status: 'unknown' })).health()).rejects.toMatchObject({ category: 'malformed_response' });
    await expect(client(mock({ ...translation, chunks: [{ id: 'wrong', text: 'Hi' }] })).translate(translation))
      .rejects.toMatchObject({ category: 'malformed_response' });
  });
  it('normalizes network, timeout and cancellation without late results', async () => {
    await expect(client(vi.fn<typeof fetch>().mockRejectedValue(new Error('private request data'))).health())
      .rejects.toMatchObject({ category: 'network' });
    const hanging = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await expect(client(hanging).health({ timeoutMs: 1 })).rejects.toMatchObject({ category: 'timeout' });
    const abort = new AbortController();
    const pending = client(hanging).health({ signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ category: 'cancelled' });
  });
  it('disallows unsupported destinations and plain HTTP outside local development', () => {
    for (const origin of ['https://api.example.com/path', 'https://user:pass@api.example.com', 'http://example.com', 'https://api.example.com?x=1']) {
      expect(() => resolveApiOrigin(origin, false)).toThrow();
    }
    expect(() => resolveApiOrigin('http://127.0.0.1:8000', true)).toThrow();
  });
});
