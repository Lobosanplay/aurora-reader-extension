export type AssistantState = 'idle' | 'extracting' | 'starting' | 'translating' | 'reading' | 'paused' | 'listening' | 'thinking' | 'answering' | 'error';

export interface TextChunk {
  id: string;
  index: number;
  originalText: string;
  translatedText?: string;
}

export interface PageContent {
  url: string;
  title: string;
  language: string | null;
  chunks: TextChunk[];
}

export type ExtensionMessage = { action: 'OPEN_AURORA' };
export type ActivationResult = { status: 'opened' } | { status: 'unsupported' } | { status: 'error' };
