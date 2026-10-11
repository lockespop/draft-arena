import { useMemo } from 'react';
import type { RoomHandle } from '../hooks/useRoom';
import type { ClientRoomView } from '../../shared/types';
import { SORTED_BY_OVR, BY_ID } from '../players';
import { Card, PlayerPicker, RosterSlots, TimerBar } from '../components/ui';

export function FreeformDraft({ rr, state }: { rr: RoomHandle; state: ClientRoomView }) {
  const me = state.drafters.find((d) => d.id === rr.youId);

  const available = useMemo(() => {
    const set = new Set(state.pool);
    return SORTED_BY_OVR.filter((p) => set.has(p.id));
  }, [state.pool]);

  const myRoster = useMemo(
    () => (me ? me.roster.map((id) => (id ? BY_ID.get(id) ?? null : null)) : []),
    [me],
  );

  const mySubmissionId = rr.youId ? state.submissions[rr.youId] : undefined;
  const mySubmission = mySubmissionId ? BY_ID.get(mySubmissionId) : null;
  const activeCount = state.drafters.filter((d) => d.roster.some((s) => s === null)).length;

  const reveal = state.lastReveal;

  return (
    <div className="flex flex-col gap-3">
      <Card className="!p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold">Round {state.round} ⚡ Free-for-All</span>
          <span className="text-xs text-slate-400">
            {state.submittedCount}/{state.drafters.length} locked in
          </span>
        </div>
        <TimerBar deadline={state.pickDeadline} />
        <p className="text-xs text-slate-400 mt-2">
          Everyone picks in secret. If 2+ of you pick the same player, that player is{' '}
          <span className="text-red-400 font-semibold">eliminated</span> — nobody gets them.
          Unique picks lock into your roster.
        </p>
      </Card>

      {reveal && (
        <Card className="!p-3 border-orange-500/40">
          <div className="text-xs font-bold uppercase tracking-wide text-orange-400 mb-1.5">
            Round {reveal.round} results
          </div>
          {reveal.assignments
            .filter((a) => a.drafterId === rr.youId)
            .map((a) => {
              const p = BY_ID.get(a.playerId);
              return (
                <div key={a.playerId} className="text-sm text-emerald-300 font-semibold">
                  ✅ You drafted {p?.name}
                </div>
              );
            })}
          {reveal.eliminations.length > 0 && (
            <div className="text-sm text-red-300 mt-1">
              🔥 Eliminated:{' '}
              {reveal.eliminations
                .map((id) => BY_ID.get(id)?.name ?? id)
                .join(', ')}
            </div>
          )}
          {reveal.assignments.length === 0 && reveal.eliminations.length === 0 && (
            <div className="text-sm text-slate-400">No picks went through that round.</div>
          )}
          <div className="text-xs text-slate-500 mt-1">
            {activeCount} drafter{activeCount === 1 ? '' : 's'} still building{' '}
            {reveal.assignments.length > 0 &&
              `· ${reveal.assignments
                .filter((a) => a.drafterId !== rr.youId)
                .map((a) => {
                  const d = state.drafters.find((x) => x.id === a.drafterId);
                  const p = BY_ID.get(a.playerId);
                  return `${d?.name} got ${p?.name}`;
                })
                .join('; ')}`}
          </div>
        </Card>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
          Your starting five
        </div>
        <RosterSlots roster={myRoster} />
      </div>

      {mySubmission ? (
        <Card className="!p-3 text-center">
          <div className="text-sm">
            🔒 Locked in: <span className="font-bold text-orange-300">{mySubmission.name}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Waiting for the reveal — or change your pick below.
          </div>
        </Card>
      ) : null}

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
          {mySubmission ? 'Change your pick' : 'Make your secret pick'} ({available.length} left)
        </div>
        <PlayerPicker
          players={available}
          draftLabel={mySubmission ? 'Change to' : 'Lock in'}
          onDraft={(p) => rr.send({ t: 'submit', playerId: p.id })}
        />
      </div>
    </div>
  );
}
