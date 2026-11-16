import { describe, expect, it } from 'vitest';
import { isActivationResult, isExtensionMessage } from '../src/services/messaging';

describe('activation protocol', () => {
  it('only accepts known commands and result variants', () => {
    expect(isExtensionMessage({ action: 'OPEN_AURORA' })).toBe(true);
    expect(isExtensionMessage({ action: 'OTHER' })).toBe(false);
    for (const status of ['opened', 'unsupported', 'error']) {
      expect(isActivationResult({ status })).toBe(true);
    }
    expect(isActivationResult({ status: 'success' })).toBe(false);
    expect(isActivationResult(undefined)).toBe(false);
  });
});
