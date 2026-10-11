import { useRoom } from './client/hooks/useRoom';
import { Home } from './client/screens/Home';
import { Lobby } from './client/screens/Lobby';
import { SnakeDraft } from './client/screens/SnakeDraft';
import { FreeformDraft } from './client/screens/FreeformDraft';
import { Results } from './client/screens/Results';

export default function App() {
  const rr = useRoom();
  const { state } = rr;

  return (
    <div className="min-h-full bg-slate-950">
      <div className="max-w-md mx-auto px-4 pt-4 pb-12 flex flex-col gap-4">
        {rr.error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-2">
            <span>{rr.error}</span>
            <button onClick={rr.clearError} className="font-bold text-lg leading-none px-1">
              ×
            </button>
          </div>
        )}

        {!state && <Home rr={rr} />}
        {state && state.phase === 'lobby' && <Lobby rr={rr} state={state} />}
        {state && state.phase === 'draft' && state.mode === 'snake' && (
          <SnakeDraft rr={rr} state={state} />
        )}
        {state && state.phase === 'draft' && state.mode === 'freeform' && (
          <FreeformDraft rr={rr} state={state} />
        )}
        {state && state.phase === 'complete' && <Results rr={rr} state={state} />}
      </div>
    </div>
  );
}
