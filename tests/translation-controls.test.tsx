import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('translation controls', () => {
  it('shows accessible selectors and consent, declines without uploading, and stays local', async () => {
    vi.stubEnv('VITE_TRANSLATION_LANGUAGES', 'en,es');
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000');
    const [{ TranslationControls }, { useReaderStore }, { strings }] = await Promise.all([
      import('../src/components/TranslationControls'),
      import('../src/stores/reader-store'),
      import('../src/components/strings')
    ]);
    const sendMessage = vi.fn(async (message: {
      action: string; requestId: string; payload?: { source_language: string; target_language: string; chunks: { id: string; text: string }[] }
    }) => ({ requestId: message.requestId, ok: true, data: message.payload && {
      source_language: message.payload.source_language, target_language: message.payload.target_language,
      chunks: message.payload.chunks.map((chunk) => ({ id: chunk.id, text: 'Texto traducido.' }))
    } }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    useReaderStore.getState().beginExtraction();
    useReaderStore.getState().setDocument({
      url: 'https://example.com', title: 'Article', language: 'en',
      chunks: [{ id: 'one', index: 0, originalText: 'Private text.' }]
    });
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.append(mount);
    document.body.append(host);
    const root = createRoot(mount);
    const stopAudio = vi.fn();
    const startAudio = vi.fn();
    flushSync(() => root.render(<TranslationControls labels={strings.en}
      stopAudio={stopAudio} startAudio={startAudio} />));
    const source = shadow.querySelector('select[aria-label="Page language"]') as HTMLSelectElement;
    const target = shadow.querySelector('select[aria-label="Read in"]') as HTMLSelectElement;
    expect(source.value).toBe('en');
    expect((target.querySelector('option[value="es"]') as HTMLOptionElement).disabled).toBe(false);
    flushSync(() => {
      target.value = 'es';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    flushSync(() => (shadow.querySelector('.aurora-translate') as HTMLButtonElement).click());
    expect(shadow.querySelector('[role="group"][aria-label="Share this article for translation?"]')).not.toBeNull();
    expect(shadow.textContent).toContain('external AI provider');
    expect(sendMessage).not.toHaveBeenCalled();
    flushSync(() => (shadow.querySelector('.aurora-consent-actions button:last-child') as HTMLButtonElement).click());
    expect(useReaderStore.getState()).toMatchObject({ translationStatus: 'cancelled', consentSession: null, narration: 'original' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(startAudio).not.toHaveBeenCalled();
    flushSync(() => (shadow.querySelector('.aurora-translate') as HTMLButtonElement).click());
    flushSync(() => (shadow.querySelector('.aurora-consent-actions button:first-child') as HTMLButtonElement).click());
    await vi.waitFor(() => expect(useReaderStore.getState().translationStatus).toBe('ready'));
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      action: 'AURORA_API_REQUEST', operation: 'translate',
      payload: { source_language: 'en', target_language: 'es', chunks: [{ id: 'one', text: 'Private text.' }] }
    });
    expect(startAudio).toHaveBeenCalledOnce();
    flushSync(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});
