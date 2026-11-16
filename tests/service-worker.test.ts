import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function setup(response: unknown = { status: 'opened' }) {
  let click: ((tab: chrome.tabs.Tab) => Promise<void>) | undefined;
  const chromeMock = {
    action: {
      onClicked: { addListener: (callback: typeof click) => { click = callback; } },
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined)
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    tabs: { sendMessage: vi.fn().mockResolvedValue(response) }
  };
  vi.stubGlobal('chrome', chromeMock);
  await import('../src/background/service-worker');
  if (!click) throw new Error('Worker failed to register toolbar listener.');
  return { click, chromeMock };
}

describe('toolbar activation', () => {
  it('opens HTML and reuses the content script activation path', async () => {
    const { click, chromeMock } = await setup();
    const tab = { id: 8, url: 'https://example.com/article' } as chrome.tabs.Tab;
    await click(tab);
    await click(tab);
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(8, { action: 'OPEN_AURORA' });
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 8, text: '' });
  });
  it('shows an unsupported badge for an explicit content-script response', async () => {
    const { click, chromeMock } = await setup({ status: 'unsupported' });
    await click({ id: 8, url: 'https://example.com/file.pdf' } as chrome.tabs.Tab);
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: 'N/A' });
  });
  it.each(['error', 'invalid'])('shows failure feedback for %s responses', async (status) => {
    const { click, chromeMock } = await setup({ status });
    await click({ id: 8, url: 'https://example.com/article' } as chrome.tabs.Tab);
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: '!' });
  });
  it('handles injection and messaging failures and restricted URLs', async () => {
    const { click, chromeMock } = await setup();
    await click({ id: 8, url: 'chrome://settings/' } as chrome.tabs.Tab);
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: 'N/A' });
    chromeMock.scripting.executeScript.mockRejectedValueOnce(new Error('restricted'));
    await click({ id: 8, url: 'https://example.com/article' } as chrome.tabs.Tab);
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 8, text: '!' });
    chromeMock.tabs.sendMessage.mockRejectedValueOnce(new Error('disconnected'));
    await click({ id: 8, url: 'https://example.com/article' } as chrome.tabs.Tab);
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 8, text: '!' });
  });
});
