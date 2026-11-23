import { useState } from 'react';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useReaderStore } from '../stores/reader-store';
import { AuroraOrb } from './AuroraOrb';
import { PlayerControls } from './PlayerControls';
import { strings } from './strings';
import { TranslationControls } from './TranslationControls';

export function AssistantWidget({ onClose, onRetry }: { onClose: () => void; onRetry: () => void }): React.JSX.Element {
  const [minimized, setMinimized] = useState(false);
  const { status, document, chunkIndex, pendingIndex, error, errorSource, translationStatus } = useReaderStore();
  const player = useAudioPlayer();
  const labels = strings[(navigator.language || document?.language || '').toLowerCase().startsWith('es') ? 'es' : 'en'];
  const statusText = status === 'reading' ? labels.reading : status === 'paused' ? labels.paused
    : status === 'extracting' ? labels.extracting : translationStatus === 'translating' ? labels.translating
      : status === 'starting' ? labels.starting : status === 'error'
      ? errorSource === 'speech' ? labels.speechError : labels.error : labels.ready;
  return <section className={`aurora-panel ${minimized ? 'aurora-panel--minimized' : ''}`} aria-label={labels.brand}>
    <header className="aurora-header">
      <span className="aurora-mark" aria-hidden="true">✦</span><strong>{labels.brand}</strong>
      <div className="aurora-header-actions">
        <button type="button" aria-label={minimized ? labels.expand : labels.minimize} onClick={() => setMinimized(!minimized)}>{minimized ? '+' : '−'}</button>
        <button type="button" aria-label={labels.close} onClick={() => { player.stop(); onClose(); }}>×</button>
      </div>
    </header>
    {!minimized && <div className="aurora-body">
      <AuroraOrb state={translationStatus === 'translating' && status !== 'reading' ? 'translating' : status} />
      <p className="aurora-status" role="status">{statusText}</p>
      {document && <div className="aurora-meta">
        <span>{labels.page}</span><strong title={document.title}>{document.title}</strong>
        <small>{labels.progress} {Math.min(chunkIndex + 1, document.chunks.length)} / {document.chunks.length}</small>
      </div>}
      {error && <div className="aurora-error" role="alert"><p>{error}</p>
        {errorSource === 'extraction' && <button type="button" onClick={onRetry}>{labels.retry}</button>}
      </div>}
      {document && <TranslationControls labels={labels} stopAudio={player.stop} startAudio={player.start} />}
      {status === 'paused' && <p className="aurora-checkpoint">{pendingIndex !== null && pendingIndex > chunkIndex ? labels.nextCheckpoint : labels.checkpoint}</p>}
      <PlayerControls status={status} available={!!document && translationStatus !== 'translating' &&
        translationStatus !== 'awaiting_consent'} speechError={errorSource === 'speech'} labels={labels} {...player} />
      <p className="aurora-footnote">{labels.privacy}</p>
    </div>}
  </section>;
}
