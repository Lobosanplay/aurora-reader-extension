export interface TranslationChunk { id: string; text: string }
export interface TranslationRequest {
  source_language: string;
  target_language: string;
  chunks: TranslationChunk[];
}
export type TranslationResponse = TranslationRequest;
export interface QuestionRequest {
  question: string;
  language: string;
  context: { title?: string; current_chunk?: string; related_chunks?: string[] };
}
export interface QuestionResponse {
  answer: string;
  source: 'page' | 'general' | 'insufficient';
  context_sufficient: boolean;
}
export interface TranscriptionResponse { text: string; language: string | null }
export interface HealthResponse { status: 'ok' }
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface TranscriptionOptions extends RequestOptions { language?: string }
