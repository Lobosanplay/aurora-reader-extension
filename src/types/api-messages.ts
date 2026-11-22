import type { ApiErrorCategory } from '../services/api-errors';
import type { HealthResponse, QuestionRequest, QuestionResponse, TranscriptionResponse, TranslationRequest, TranslationResponse } from './api';

export type ApiOperation = 'translate' | 'ask' | 'transcribe' | 'health';
export type ApiRequestMessage =
  | { action: 'AURORA_API_REQUEST'; requestId: string; operation: 'translate'; payload: TranslationRequest }
  | { action: 'AURORA_API_REQUEST'; requestId: string; operation: 'ask'; payload: QuestionRequest }
  | { action: 'AURORA_API_REQUEST'; requestId: string; operation: 'transcribe'; payload: { bytes: number[]; language?: string } }
  | { action: 'AURORA_API_REQUEST'; requestId: string; operation: 'health' };
export type ApiCancelMessage = { action: 'AURORA_API_CANCEL'; requestId: string };
export type ApiMessage = ApiRequestMessage | ApiCancelMessage;
export type ApiResult<T = TranslationResponse | QuestionResponse | TranscriptionResponse | HealthResponse> =
  | { requestId: string; ok: true; data: T }
  | { requestId: string; ok: false; error: { category: ApiErrorCategory; message: string; status?: number; requestId?: string; retryAfter?: string } };
