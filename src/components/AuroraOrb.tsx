import type { AssistantState } from '../types';

export function AuroraOrb({ state }: { state: AssistantState }): React.JSX.Element {
  return <div className={`aurora-orb aurora-orb--${state}`} aria-hidden="true"><div className="aurora-orb__core" /></div>;
}
