import type {
  HealthResponse, QuestionRequest, QuestionResponse, RequestOptions, TranscriptionOptions,
  TranscriptionResponse, TranslationRequest, TranslationResponse
} from '../types/api';
import { ApiClientError, type ApiErrorCategory } from './api-errors';
import {
  validateHealthResponse, validateQuestionRequest, validateQuestionResponse,
  validateTranscriptionResponse, validateTranslationRequest, validateTranslationResponse
} from '../utils/api-validation';

const codes: Record<string, ApiErrorCategory> = {
  INVALID_INPUT: 'validation', UNSUPPORTED_LANGUAGE: 'validation', INVALID_AUDIO: 'validation',
  PAYLOAD_TOO_LARGE: 'validation', UNSUPPORTED_MEDIA_TYPE: 'validation',
  UNAUTHORIZED: 'unauthorized', FORBIDDEN: 'unauthorized',
  RATE_LIMITED: 'rate_limited', PROVIDER_RATE_LIMITED: 'rate_limited',
  PROVIDER_UNAVAILABLE: 'provider_unavailable', PROVIDER_QUOTA_EXCEEDED: 'provider_unavailable',
  PROVIDER_TIMEOUT: 'provider_timeout', PROVIDER_FAILURE: 'provider_failure',
  BAD_UPSTREAM_RESPONSE: 'provider_failure'
};
const safeMessages: Record<ApiErrorCategory, string> = {
  validation: 'Check the request and try again.', unauthorized: 'API access is unavailable.',
  rate_limited: 'Too many requests. Please try again later.',
  provider_unavailable: 'The API provider is unavailable.', provider_timeout: 'The API provider timed out.',
  provider_failure: 'The API provider could not complete the request.',
  malformed_response: 'The server returned an invalid response.', network: 'Unable to reach the API.',
  cancelled: 'Request cancelled.', timeout: 'The request timed out.', unavailable: 'The API is unavailable.'
};

export function resolveApiOrigin(value: string, production = import.meta.env.PROD): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Configure a valid VITE_API_BASE_URL origin.'); }
  if (url.origin === 'null' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    (url.protocol !== 'https:' && !( !production && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('VITE_API_BASE_URL must be an allowed API origin (HTTPS in production).');
  }
  return url.origin;
}

function serverError(response: Response, body: unknown): ApiClientError {
  const id = response.headers.get('X-Request-ID') ?? undefined;
  const retry = response.headers.get('Retry-After') ?? undefined;
  let code: string | undefined;
  let requestId = id;
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = body.error;
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' &&
      'request_id' in error && typeof error.request_id === 'string') {
      code = error.code;
      requestId = error.request_id;
    }
  }
  const category = (code && codes[code]) || (
    response.status === 401 || response.status === 403 ? 'unauthorized' :
      response.status === 429 ? 'rate_limited' : response.status === 504 ? 'provider_timeout' :
        response.status === 503 ? 'provider_unavailable' : response.status === 502 ? 'provider_failure' :
          response.status >= 400 && response.status < 500 ? 'validation' : 'unavailable'
  );
  return new ApiClientError(category, safeMessages[category], response.status, requestId, retry);
}

export class AuroraApiClient {
  private readonly origin: string;
  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch, private readonly defaultTimeoutMs = 35000) {
    this.origin = resolveApiOrigin(baseUrl);
  }

  private async request(path: string, init: RequestInit, options: RequestOptions = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ApiClientError('validation', 'Invalid timeout.');
    let timedOut = false;
    const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      if (options.signal?.aborted) throw new ApiClientError('cancelled', safeMessages.cancelled);
      const response = await this.fetcher(`${this.origin}${path}`, {
        ...init, signal: controller.signal, credentials: 'omit', redirect: 'error'
      });
      let body: unknown;
      try { body = await response.json(); } catch {
        if (response.ok) throw new ApiClientError('malformed_response', safeMessages.malformed_response, response.status, response.headers.get('X-Request-ID') ?? undefined);
      }
      if (options.signal?.aborted || timedOut) throw new ApiClientError(timedOut ? 'timeout' : 'cancelled', safeMessages[timedOut ? 'timeout' : 'cancelled']);
      if (!response.ok) throw serverError(response, body);
      return body;
    } catch (error) {
      if (timedOut) throw new ApiClientError('timeout', safeMessages.timeout);
      if (options.signal?.aborted) throw new ApiClientError('cancelled', safeMessages.cancelled);
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError('network', safeMessages.network);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async translate(request: TranslationRequest, options?: RequestOptions): Promise<TranslationResponse> {
    validateTranslationRequest(request);
    return validateTranslationResponse(await this.request('/api/v1/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
    }, options), request);
  }

  async ask(request: QuestionRequest, options?: RequestOptions): Promise<QuestionResponse> {
    validateQuestionRequest(request);
    return validateQuestionResponse(await this.request('/api/v1/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
    }, options), request);
  }

  async transcribe(audio: Blob, options: TranscriptionOptions = {}): Promise<TranscriptionResponse> {
    if (!(audio instanceof Blob) || audio.type !== 'audio/wav' || audio.size === 0 || audio.size > 5_000_000 ||
      (options.language !== undefined && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(options.language))) {
      throw new ApiClientError('validation', 'A valid PCM WAV upload and language hint are required.');
    }
    const form = new FormData();
    form.append('file', audio, 'audio.wav');
    if (options.language) form.append('language', options.language);
    return validateTranscriptionResponse(await this.request('/api/v1/transcribe', { method: 'POST', body: form }, options));
  }

  async health(options?: RequestOptions): Promise<HealthResponse> {
    return validateHealthResponse(await this.request('/health', { method: 'GET' }, options));
  }
}
