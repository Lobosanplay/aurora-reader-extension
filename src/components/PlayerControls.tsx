import type { AssistantState } from '../types';
import type { strings } from './strings';

interface Props {
  status: AssistantState;
  available: boolean;
  speechError: boolean;
  labels: typeof strings.en;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export function PlayerControls({ status, available, speechError, labels, start, pause, resume, stop }: Props): React.JSX.Element {
  return <div className="aurora-controls">
    {status === 'reading' || status === 'starting' ? <button type="button" className="aurora-primary" disabled={!available} onClick={pause}>{labels.pause}</button>
      : status === 'paused' ? <button type="button" className="aurora-primary" disabled={!available} onClick={resume}>{labels.resume}</button>
        : <button type="button" className="aurora-primary" disabled={!available || status === 'extracting'} onClick={start}>{speechError ? labels.retrySpeech : labels.start}</button>}
    <button type="button" className="aurora-secondary" disabled={!available || (status !== 'reading' && status !== 'starting' && status !== 'paused')} onClick={stop}>{labels.stop}</button>
  </div>;
}
