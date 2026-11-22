import type { ActivationResult, ExtensionMessage } from '../types';
import type {
  HealthResponse, QuestionRequest, QuestionResponse, RequestOptions,
  TranscriptionOptions, TranscriptionResponse, TranslationRequest, TranslationResponse
} from '../types/api';
import type { ApiOperation, ApiRequestMessage, ApiResult } from '../types/api-messages';
import { ApiClientError } from './api-errors';
import {
  validateHealthResponse, validateQuestionRequest, validateQuestionResponse,
  validateTranscriptionResponse, validateTranslationRequest, validateTranslationResponse
} from '../utils/api-validation';

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === 'object' && value !== null && 'action' in value && value.action === 'OPEN_AURORA';
}

export function isActivationResult(value: unknown): value is ActivationResult {
  return typeof value === 'object' && value !== null && 'status' in value &&
    (value.status === 'opened' || value.status === 'unsupported' || value.status === 'error');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class BackgroundApi {
  constructor(private readonly send: (message: unknown) => Promise<unknown> =
    (message) => chrome.runtime.sendMessage(message)) {}

  private async request<T>(operation: ApiOperation, payload: TranslationRequest | QuestionRequest | { bytes: number[]; language?: string } | undefined,
    validate: (value: unknown) => T, options: RequestOptions = {}): Promise<T> {
    const requestId = crypto.randomUUID();
    if (options.signal?.aborted) throw new ApiClientError('cancelled', 'Request cancelled.');
    const message: ApiRequestMessage = operation === 'health'
      ? { action: 'AURORA_API_REQUEST', operation, requestId }
      : { action: 'AURORA_API_REQUEST', operation, requestId, payload } as ApiRequestMessage;
    let abortListener: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectPending: ((error: ApiClientError) => void) | undefined;
    const timeoutMs = options.timeoutMs ?? 40000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ApiClientError('validation', 'Invalid timeout.');
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectPending = reject;
      abortListener = () => {
        // The signal stays local; cancellation is an explicit, best-effort second message.
        void this.send({ action: 'AURORA_API_CANCEL', requestId }).catch(() => undefined);
        reject(new ApiClientError('cancelled', 'Request cancelled.'));
      };
      options.signal?.addEventListener('abort', abortListener, { once: true });
    });
    timer = setTimeout(() => {
      void this.send({ action: 'AURORA_API_CANCEL', requestId }).catch(() => undefined);
      rejectPending?.(new ApiClientError('timeout', 'The background worker timed out.'));
    }, timeoutMs);
    try {
      const response = await Promise.race([this.send(message), cancelled]);
      if (options.signal?.aborted) throw new ApiClientError('cancelled', 'Request cancelled.');
      if (!isRecord(response) || response.requestId !== requestId || typeof response.ok !== 'boolean') {
        throw new ApiClientError('malformed_response', 'Invalid background response.');
      }
      if (!response.ok) {
        const error = response.error;
        const categories = ['validation', 'unauthorized', 'rate_limited', 'provider_unavailable',
          'provider_timeout', 'provider_failure', 'malformed_response', 'network', 'cancelled', 'timeout', 'unavailable'];
        if (!isRecord(error) || !categories.includes(error.category as string)) {
          throw new ApiClientError('malformed_response', 'Invalid background response.');
        }
        throw new ApiClientError(error.category as ApiClientError['category'], 'The API request failed.',
          typeof error.status === 'number' ? error.status : undefined,
          typeof error.requestId === 'string' ? error.requestId : undefined,
          typeof error.retryAfter === 'string' ? error.retryAfter : undefined);
      }
      return validate((response as ApiResult & { data: unknown }).data);
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError('unavailable', 'The background worker is unavailable.');
    } finally {
      clearTimeout(timer);
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
    }
  }

  translate(request: TranslationRequest, options?: RequestOptions): Promise<TranslationResponse> {
    validateTranslationRequest(request);
    return this.request('translate', request, (value) => validateTranslationResponse(value, request), options);
  }
  ask(request: QuestionRequest, options?: RequestOptions): Promise<QuestionResponse> {
    validateQuestionRequest(request);
    return this.request('ask', request, (value) => validateQuestionResponse(value, request), options);
  }
  async transcribe(audio: Blob, options: TranscriptionOptions = {}): Promise<TranscriptionResponse> {
    if (!(audio instanceof Blob) || audio.type !== 'audio/wav' || audio.size === 0 || audio.size > 5_000_000 ||
      (options.language !== undefined && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(options.language))) {
      throw new ApiClientError('validation', 'A bounded WAV upload is required.');
    }
    const bytes = Array.from(new Uint8Array(await audio.arrayBuffer()));
    if (options.signal?.aborted) throw new ApiClientError('cancelled', 'Request cancelled.');
    return this.request('transcribe', { bytes, language: options.language },
      validateTranscriptionResponse, options);
  }
  health(options?: RequestOptions): Promise<HealthResponse> {
    return this.request('health', undefined, validateHealthResponse, options);
  }
}
