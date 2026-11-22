export type ApiErrorCategory =
  | 'validation' | 'unauthorized' | 'rate_limited' | 'provider_unavailable'
  | 'provider_timeout' | 'provider_failure' | 'malformed_response'
  | 'network' | 'cancelled' | 'timeout' | 'unavailable';

export class ApiClientError extends Error {
  constructor(
    public readonly category: ApiErrorCategory,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    public readonly retryAfter?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}
