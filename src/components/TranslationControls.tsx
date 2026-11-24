import { useEffect, useRef } from 'react';
import { languageLabel, languageOptions, translationLanguages } from '../services/translation-languages';
import { TranslationSession } from '../services/translation-session';
import { useReaderStore } from '../stores/reader-store';
import type { strings } from './strings';

export function TranslationControls({ labels, stopAudio, startAudio }: {
  labels: typeof strings.en; stopAudio: () => void; startAudio: () => void
}): React.JSX.Element {
  const state = useReaderStore();
  const session = useRef<TranslationSession | null>(null);
  useEffect(() => {
    const instance = new TranslationSession();
    session.current = instance;
    return () => { instance.dispose(); session.current = null; };
  }, []);
  if (!state.document) return <></>;
  const sameLanguage = state.sourceLanguage !== null && state.sourceLanguage === state.targetLanguage;
  const supported = translationLanguages.includes(state.sourceLanguage ?? '') &&
    translationLanguages.includes(state.targetLanguage) && !!import.meta.env.VITE_API_BASE_URL;
  const locked = state.status === 'reading' || state.status === 'starting';
  const change = (kind: 'source' | 'target', value: string): void => {
    stopAudio();
    if (kind === 'source') state.setSourceLanguage(value);
    else state.setTargetLanguage(value);
  };
  const translateAndRead = async (): Promise<void> => {
    const { sessionId, translationOperation } = useReaderStore.getState();
    await session.current?.translate();
    const current = useReaderStore.getState();
    if (current.sessionId === sessionId && current.translationOperation === translationOperation &&
      current.translationStatus === 'ready') startAudio();
  };
  const run = (): void => {
    if (state.status === 'paused') stopAudio();
    if (state.translationStatus === 'ready') {
      stopAudio();
      useReaderStore.getState().readTranslated();
      startAudio();
    } else if (useReaderStore.getState().consentSession === state.sessionId) void translateAndRead();
    else state.requestConsent();
  };
  return <div className="aurora-translation">
    <div className="aurora-languages">
      <label>{labels.source}
        <select aria-label={labels.source} value={state.sourceLanguage ?? ''} disabled={locked}
          onChange={(event) => change('source', event.target.value)}>
          <option value="">{labels.unknown}</option>
          {state.sourceLanguage && !languageOptions.some((option) => option.code === state.sourceLanguage) &&
            <option value={state.sourceLanguage}>{languageLabel(state.sourceLanguage)} · HTML</option>}
          {languageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
        </select>
      </label>
      <label>{labels.target}
        <select aria-label={labels.target} value={state.targetLanguage} disabled={locked}
          onChange={(event) => change('target', event.target.value)}>
          {languageOptions.map((option) => <option key={option.code} value={option.code}
            disabled={option.code !== state.sourceLanguage && !translationLanguages.includes(option.code)}>{option.label}</option>)}
        </select>
      </label>
    </div>
    {state.translationStatus === 'awaiting_consent' && <div className="aurora-consent" role="group" aria-label={labels.consentTitle}>
      <strong>{labels.consentTitle}</strong><p>{labels.consentBody}</p>
      <div className="aurora-consent-actions">
        <button type="button" onClick={() => { state.authorizeTranslation(); void translateAndRead(); }}>{labels.confirm}</button>
        <button type="button" onClick={state.declineConsent}>{labels.cancel}</button>
      </div>
    </div>}
    {state.translationStatus === 'translating' && <>
      <p role="status">{labels.translating} {state.translatedCount} / {state.document.chunks.length}</p>
      <button type="button" className="aurora-original" onClick={stopAudio}>{labels.stop}</button>
    </>}
    {state.translationStatus === 'ready' && <p role="status">{labels.translated}</p>}
    {state.translationError && <p className="aurora-translation-error" role="alert">{state.translationError}</p>}
    {!state.sourceLanguage && <p className="aurora-hint">{labels.chooseSource}</p>}
    {!sameLanguage && state.sourceLanguage && !supported && <p className="aurora-hint">{labels.backendDisabled}</p>}
    {state.translationStatus !== 'awaiting_consent' && !sameLanguage && <button type="button" className="aurora-translate"
      disabled={!supported || locked || state.translationStatus === 'translating'}
      onClick={run}>{state.translationStatus === 'ready' ? labels.readTranslated : labels.translate}</button>}
    {state.narration === 'translated' && <button type="button" className="aurora-original" onClick={() => {
      stopAudio(); state.readOriginal(); startAudio();
    }}>{labels.readOriginal}</button>}
  </div>;
}
