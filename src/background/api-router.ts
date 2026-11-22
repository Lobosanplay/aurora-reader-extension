import { AuroraApiClient } from '../services/api-client';
import { ApiClientError } from '../services/api-errors';
import type { ApiMessage, ApiResult } from '../types/api-messages';
import type { HealthResponse, QuestionResponse, TranscriptionResponse, TranslationResponse } from '../types/api';
import { validateQuestionRequest, validateTranslationRequest } from '../utils/api-validation';

const requestIdPattern = /^[A-Za-z0-9_-]{1,100}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isApiMessage(value: unknown): value is ApiMessage {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId)) return false;
  if (value.action === 'AURORA_API_CANCEL') return Object.keys(value).length === 2;
  if (value.action !== 'AURORA_API_REQUEST' || typeof value.operation !== 'string') return false;
  try {
    if (value.operation === 'health') return Object.keys(value).length === 3;
    if (Object.keys(value).length !== 4) return false;
    if (value.operation === 'translate') { validateTranslationRequest(value.payload); return true; }
    if (value.operation === 'ask') { validateQuestionRequest(value.payload); return true; }
    if (value.operation === 'transcribe' && isRecord(value.payload)) {
      const { bytes, language } = value.payload;
      return Object.keys(value.payload).every((key) => key === 'bytes' || key === 'language') &&
        Array.isArray(bytes) && bytes.length > 0 && bytes.length <= 5_000_000 &&
        bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) &&
        (language === undefined || (typeof language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)));
    }
  } catch { return false; }
  return false;
}

export function isApiSender(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  return sender.id === extensionId && sender.tab?.id !== undefined &&
    sender.frameId === 0 && sender.documentId !== undefined &&
    typeof sender.url === 'string' && /^https?:\/\//i.test(sender.url) &&
    sender.url === sender.tab.url;
}

const senderKey = (sender: chrome.runtime.MessageSender): string =>
  `${sender.tab!.id}:${sender.documentId}:${sender.frameId}`;

export function createApiRouter(client: AuroraApiClient, extensionId: string) {
  const pending = new Map<string, AbortController>();
  const listener = (value: unknown, sender: chrome.runtime.MessageSender, respond: (result: ApiResult) => void): boolean | undefined => {
    if (!isApiSender(sender, extensionId) || !isApiMessage(value)) return;
    const key = `${senderKey(sender)}:${value.requestId}`;
    if (value.action === 'AURORA_API_CANCEL') {
      pending.get(key)?.abort();
      pending.delete(key);
      respond({ requestId: value.requestId, ok: true, data: { status: 'ok' } });
      return false;
    }
    if (pending.has(key)) {
      respond({ requestId: value.requestId, ok: false, error: { category: 'validation', message: 'Duplicate request ID.' } });
      return false;
    }
    const controller = new AbortController();
    pending.set(key, controller);
    const result = async (): Promise<ApiResult> => {
      try {
        let data: HealthResponse | QuestionResponse | TranscriptionResponse | TranslationResponse;
        switch (value.operation) {
          case 'translate': data = await client.translate(value.payload, { signal: controller.signal }); break;
          case 'ask': data = await client.ask(value.payload, { signal: controller.signal }); break;
          case 'transcribe': data = await client.transcribe(
            new Blob([new Uint8Array(value.payload.bytes)], { type: 'audio/wav' }),
            { signal: controller.signal, language: value.payload.language }
          ); break;
          case 'health': data = await client.health({ signal: controller.signal }); break;
        }
        return { requestId: value.requestId, ok: true, data };
      } catch (error) {
        const safe = error instanceof ApiClientError ? error : new ApiClientError('unavailable', 'The API is unavailable.');
        return { requestId: value.requestId, ok: false, error: {
          category: safe.category, message: safe.message, status: safe.status,
          requestId: safe.requestId, retryAfter: safe.retryAfter
        } };
      }
    };
    void result().then((response) => {
      if (pending.get(key) === controller && !controller.signal.aborted) respond(response);
    }).finally(() => { if (pending.get(key) === controller) pending.delete(key); });
    return true;
  };
  const cancelTab = (tabId: number): void => {
    for (const [key, controller] of pending) {
      if (key.startsWith(`${tabId}:`)) { controller.abort(); pending.delete(key); }
    }
  };
  return { listener, cancelTab, pendingCount: (): number => pending.size };
}
