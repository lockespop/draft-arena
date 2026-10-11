import { useMemo, useState } from 'react';
import type { RoomHandle } from '../hooks/useRoom';
import type { ClientRoomView } from '../../shared/types';
import { SORTED_BY_OVR, BY_ID } from '../players';
import { Card, OvrBadge, PlayerPicker, RosterSlots, TimerBar } from '../components/ui';

export function SnakeDraft({ rr, state }: { rr: RoomHandle; state: ClientRoomView }) {
  const [showAll, setShowAll] = useState(false);

  const me = state.drafters.find((d) => d.id === rr.youId);
  const currentId = state.pickOrder[state.currentPick];
  const current = state.drafters.find((d) => d.id === currentId);
  const isMyTurn = currentId === rr.youId;

  const available = useMemo(() => {
    const set = new Set(state.pool);
    return SORTED_BY_OVR.filter((p) => set.has(p.id));
  }, [state.pool]);

  const myRoster = useMemo(
    () => (me ? me.roster.map((id) => (id ? BY_ID.get(id) ?? null : null)) : []),
    [me],
  );

  const totalPicks = state.pickOrder.length;
  const round = Math.floor(state.currentPick / state.drafters.length) + 1;

  return (
    <div className="flex flex-col gap-3">
      <Card className="!p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold">
            Pick {Math.min(state.currentPick + 1, totalPicks)} of {totalPicks} · Round {round}/5
          </span>
          <span className="text-xs text-slate-400">🐍 Snake</span>
        </div>
        <TimerBar deadline={state.pickDeadline} />
        <div
          className={`mt-2 text-center text-sm font-semibold rounded-xl py-2 ${
            isMyTurn ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {isMyTurn
            ? '🎯 Your pick — choose below!'
            : current
              ? `${current.isBot ? '🤖' : '🧑'} ${current.name} is picking…`
              : 'Waiting…'}
        </div>
      </Card>

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
          Your starting five
        </div>
        <RosterSlots roster={myRoster} />
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
          Available players ({available.length})
        </div>
        <PlayerPicker
          players={available}
          draftLabel="Draft"
          disabled={!isMyTurn}
          onDraft={(p) => rr.send({ t: 'pick', playerId: p.id })}
        />
        {!isMyTurn && (
          <p className="text-xs text-slate-500 text-center mt-1">
            You'll be able to draft when it's your turn.
          </p>
        )}
      </div>

      <div>
        <button
          onClick={() => setShowAll((s) => !s)}
          className="text-sm text-slate-300 font-semibold py-2"
        >
          {showAll ? '▾ Hide' : '▸ Show'} all teams
        </button>
        {showAll && (
          <div className="flex flex-col gap-2">
            {state.drafters.map((d) => (
              <Card key={d.id} className="!p-3">
                <div className="text-sm font-bold mb-1.5">
                  {d.isBot ? '🤖' : '🧑'} {d.name}
                  {d.id === rr.youId && <span className="text-orange-400"> (you)</span>}
                  {d.id === currentId && <span className="text-emerald-400"> ← picking</span>}
                </div>
                <div className="flex flex-col gap-1">
                  {d.roster.map((id, i) => {
                    const p = id ? BY_ID.get(id) : null;
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-6 text-slate-500 font-bold">
                          {['PG', 'SG', 'SF', 'PF', 'C'][i]}
                        </span>
                        {p ? (
                          <>
                            <span className="flex-1 truncate text-slate-200">{p.name}</span>
                            <OvrBadge ovr={p.ovr} />
                          </>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
