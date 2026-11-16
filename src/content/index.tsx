import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AssistantWidget } from '../components/AssistantWidget';
import { extractPage } from './extract-page';
import { useReaderStore } from '../stores/reader-store';
import { isExtensionMessage } from '../services/messaging';
import css from '../styles/aurora.css?inline';
import { watchPage } from './watch-page';
import type { ActivationResult } from '../types';

const global = globalThis as typeof globalThis & { __auroraReader?: { open: () => void } };

if (!global.__auroraReader) {
  let host: HTMLElement | null = null;
  let root: Root | null = null;
  let stopWatching: (() => void) | null = null;

  const extract = (): void => {
    useReaderStore.getState().beginExtraction();
    try {
      useReaderStore.getState().setDocument(extractPage());
    } catch (error) {
      useReaderStore.getState().fail(error instanceof Error ? error.message : 'Unable to extract this page. Try another article.', 'extraction');
    }
  };

  const close = (): void => {
    stopWatching?.();
    stopWatching = null;
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
    useReaderStore.getState().beginExtraction();
  };

  const open = (): ActivationResult => {
    if (document.contentType !== 'text/html') return { status: 'unsupported' };
    if (host?.isConnected) return { status: 'opened' };
    if (root) close();
    try {
      host = document.createElement('div');
      host.id = 'aurora-reader-host';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = css;
      shadow.append(style);
      const mount = document.createElement('div');
      shadow.append(mount);
      (document.body ?? document.documentElement).append(host);
      root = createRoot(mount);
      root.render(<React.StrictMode><AssistantWidget onClose={close} onRetry={extract} /></React.StrictMode>);
      extract();
      stopWatching = watchPage(document, () => {
        if (!host?.isConnected) { close(); return; }
        extract();
      }, () => !!host?.isConnected);
      return { status: 'opened' };
    } catch {
      close();
      return { status: 'error' };
    }
  };

  chrome.runtime.onMessage.addListener((value: unknown, sender, sendResponse: (response: ActivationResult) => void) => {
    if (sender.id !== chrome.runtime.id || !isExtensionMessage(value)) return;
    sendResponse(open());
  });
  window.addEventListener('pagehide', close);
  global.__auroraReader = { open };
}
