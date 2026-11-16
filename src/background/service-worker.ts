import type { ExtensionMessage } from '../types';
import { isActivationResult } from '../services/messaging';

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  const url = tab.url ?? '';
  const supported = /^https?:\/\//i.test(url) && !/^https?:\/\/(?:chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/i.test(url);
  if (!supported) {
    await chrome.action.setBadgeText({ tabId, text: 'N/A' });
    await chrome.action.setTitle({ tabId, title: 'Aurora Reader supports ordinary HTTP(S) pages only.' });
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const message: ExtensionMessage = { action: 'OPEN_AURORA' };
    const response: unknown = await chrome.tabs.sendMessage(tabId, message);
    if (!isActivationResult(response)) throw new Error('No valid activation response from the content script.');
    if (response.status === 'error') throw new Error('The widget could not initialize.');
    await chrome.action.setBadgeText({ tabId, text: response.status === 'unsupported' ? 'N/A' : '' });
    await chrome.action.setTitle({ tabId, title: response.status === 'unsupported'
      ? 'Aurora Reader supports HTML articles only.' : 'Open Aurora Reader' });
  } catch (error) {
    console.error('Aurora Reader activation failed:', error);
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: 'Cannot open Aurora Reader here. Try an ordinary article page and reload it.' });
  }
});
