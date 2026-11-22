import { describe, expect, it, vi } from 'vitest';
import { createApiRouter, isApiMessage } from '../src/background/api-router';
import { BackgroundApi } from '../src/services/messaging';
import { AuroraApiClient } from '../src/services/api-client';

const sender = {
  id: 'extension', frameId: 0, documentId: 'doc-1',
  url: 'https://article.example/story', tab: { id: 3, url: 'https://article.example/story' }
} as chrome.runtime.MessageSender;
const translation = { source_language: 'en', target_language: 'es', chunks: [{ id: 'a', text: 'Hello' }] };
const message = (requestId = 'one') => ({ action: 'AURORA_API_REQUEST', operation: 'translate', requestId, payload: translation });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const fakeClient = (translate = vi.fn().mockResolvedValue(translation)) =>
  ({ translate, ask: vi.fn(), transcribe: vi.fn(), health: vi.fn().mockResolvedValue({ status: 'ok' }) }) as unknown as AuroraApiClient;

describe('background API routing', () => {
  it('accepts only fixed operations, bounded payloads and the originating top-level document', async () => {
    const client = fakeClient();
    const router = createApiRouter(client, 'extension');
    const respond = vi.fn();
    expect(router.listener(message(), sender, respond)).toBe(true);
    await flush();
    expect(respond).toHaveBeenCalledWith({ requestId: 'one', ok: true, data: translation });
    expect(router.pendingCount()).toBe(0);
    expect(router.listener({ ...message(), url: 'https://evil.example' }, sender, respond)).toBeUndefined();
    expect(router.listener({ ...message(), operation: 'proxy' }, sender, respond)).toBeUndefined();
    expect(router.listener({ ...message(), payload: { ...translation, chunks: [] } }, sender, respond)).toBeUndefined();
    expect(router.listener(message(), { ...sender, frameId: 1 }, respond)).toBeUndefined();
    expect(router.listener(message(), { ...sender, id: 'other' }, respond)).toBeUndefined();
    expect(router.listener(message(), { ...sender, documentId: undefined }, respond)).toBeUndefined();
    expect(isApiMessage({ ...message(), requestId: undefined })).toBe(false);
    expect(client.translate).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicate IDs and cancels only requests from the same document', async () => {
    let finish!: (value: typeof translation) => void;
    const client = fakeClient(vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })));
    const router = createApiRouter(client, 'extension');
    const first = vi.fn();
    const duplicate = vi.fn();
    router.listener(message(), sender, first);
    router.listener(message(), sender, duplicate);
    expect(duplicate).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(router.pendingCount()).toBe(1);
    router.listener({ action: 'AURORA_API_CANCEL', requestId: 'one' },
      { ...sender, documentId: 'another' }, vi.fn());
    expect(router.pendingCount()).toBe(1);
    router.listener({ action: 'AURORA_API_CANCEL', requestId: 'one' }, sender, vi.fn());
    finish(translation);
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(router.pendingCount()).toBe(0);
  });
  it('sanitizes unexpected worker failures and aborts on navigation', async () => {
    const router = createApiRouter(fakeClient(vi.fn().mockRejectedValue(new Error('private page text'))), 'extension');
    const reply = vi.fn();
    router.listener(message(), sender, reply);
    await flush();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      ok: false, error: expect.objectContaining({ category: 'unavailable' })
    }));
    expect(JSON.stringify(reply.mock.calls)).not.toContain('private page text');
    expect(router.pendingCount()).toBe(0);
    const pending = createApiRouter(fakeClient(vi.fn().mockImplementation(() => new Promise(() => undefined))), 'extension');
    pending.listener(message(), sender, vi.fn());
    pending.cancelTab(3);
    expect(pending.pendingCount()).toBe(0);
  });
});

describe('content API messaging', () => {
  it('validates the reply and ignores late results after cancellation', async () => {
    const send = vi.fn(async (value: unknown) => {
      const msg = value as { requestId: string; action: string };
      return { requestId: msg.requestId, ok: true, data: translation };
    });
    expect(await new BackgroundApi(send).translate(translation)).toEqual(translation);
    const abort = new AbortController();
    let resolve!: (value: unknown) => void;
    const delayed = vi.fn((value: unknown): Promise<unknown> => (value as { action: string }).action === 'AURORA_API_CANCEL'
      ? Promise.resolve({ ok: true }) : new Promise((done) => { resolve = done; }));
    const result = new BackgroundApi(delayed).translate(translation, { signal: abort.signal });
    abort.abort();
    await expect(result).rejects.toMatchObject({ category: 'cancelled' });
    expect(delayed).toHaveBeenCalledWith(expect.objectContaining({ action: 'AURORA_API_CANCEL' }));
    resolve({ ok: true, data: translation });
    await flush();
  });
  it('rejects malformed and disconnected worker replies', async () => {
    await expect(new BackgroundApi(async () => ({ ok: true, requestId: 'wrong' })).health())
      .rejects.toMatchObject({ category: 'malformed_response' });
    await expect(new BackgroundApi(async () => { throw new Error('private'); }).health())
      .rejects.toMatchObject({ category: 'unavailable' });
    await expect(new BackgroundApi(() => new Promise(() => undefined)).health({ timeoutMs: 1 }))
      .rejects.toMatchObject({ category: 'timeout' });
  });
});
