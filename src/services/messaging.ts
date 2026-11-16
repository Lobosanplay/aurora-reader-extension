import type { ActivationResult, ExtensionMessage } from '../types';

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === 'object' && value !== null && 'action' in value && value.action === 'OPEN_AURORA';
}

export function isActivationResult(value: unknown): value is ActivationResult {
  return typeof value === 'object' && value !== null && 'status' in value &&
    (value.status === 'opened' || value.status === 'unsupported' || value.status === 'error');
}
