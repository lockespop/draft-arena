import { useEffect, useMemo, useState } from 'react';
import type { RoomHandle } from '../hooks/useRoom';
import type { ClientRoomView, FreeformPick } from '../../shared/types';
import { SLOTS } from '../../shared/types';
import { SORTED_BY_OVR, BY_ID } from '../players';
import { Card, PlayerPicker, RosterSlots, TimerBar } from '../components/ui';

export function FreeformDraft({ rr, state }: { rr: RoomHandle; state: ClientRoomView }) {
  const me = state.drafters.find((d) => d.id === rr.youId);

  const poolSet = useMemo(() => new Set(state.pool), [state.pool]);

  const emptySlots = useMemo(
    () =>
      me
        ? me.roster.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0)
        : [],
    [me],
  );

  // This round's lineup attempt: slot index -> playerId
  const [lineup, setLineup] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState(false);
  // New round -> fresh lineup.
  useEffect(() => {
    setLineup({});
    setEditing(false);
  }, [state.round]);

  const myRoster = useMemo(
    () => (me ? me.roster.map((id) => (id ? BY_ID.get(id) ?? null : null)) : []),
    [me],
  );

  const submitted: FreeformPick[] | undefined =
    rr.youId ? state.submissions[rr.youId] : undefined;
  const showPickers = !submitted || editing;

  const chosenIds = useMemo(() => new Set(Object.values(lineup)), [lineup]);

  const availableForSlot = (slot: number) => {
    const pos = SLOTS[slot];
    return SORTED_BY_OVR.filter(
      (p) =>
        poolSet.has(p.id) &&
        (p.pos === pos || p.pos2 === pos) &&
        !chosenIds.has(p.id),
    );
  };

  const filledCount = emptySlots.filter((s) => lineup[s]).length;
  const complete = emptySlots.length > 0 && filledCount === emptySlots.length;

  const submit = () => {
    if (!complete) return;
    const picks: FreeformPick[] = emptySlots.map((slot) => ({
      slot,
      playerId: lineup[slot],
    }));
    rr.send({ t: 'submit', picks });
    setEditing(false);
  };

  const startEdit = () => {
    const backfill: Record<number, string> = {};
    for (const p of submitted ?? []) backfill[p.slot] = p.playerId;
    setLineup(backfill);
    setEditing(true);
  };

  const activeCount = state.drafters.filter((d) => d.roster.some((s) => s === null)).length;
  const reveal = state.lastReveal;

  return (
    <div className="flex flex-col gap-3">
      <Card className="!p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold">Round {state.round} ⚡ Free-for-All</span>
          <span className="text-xs text-slate-400">
            {state.submittedCount}/{activeCount} lineups in
          </span>
        </div>
        <TimerBar deadline={state.pickDeadline} />
        <p className="text-xs text-slate-400 mt-2">
          Build your starting five in secret — one player per open slot. If 2+ drafters
          pick the same player, that player is{' '}
          <span className="text-red-400 font-semibold">eliminated</span> — nobody gets
          them. Unique picks lock into your roster. Fill your five and you sit out.
        </p>
      </Card>

      {reveal && (
        <Card className="!p-3 border-orange-500/40">
          <div className="text-xs font-bold uppercase tracking-wide text-orange-400 mb-1.5">
            Round {reveal.round} reveal
          </div>
          {reveal.assignments.length > 0 && (
            <div className="mb-1.5">
              <div className="text-xs font-bold text-emerald-400 mb-1">
                ✅ Locked in
              </div>
              {reveal.assignments.map((a) => {
                const p = BY_ID.get(a.playerId);
                const d = state.drafters.find((x) => x.id === a.drafterId);
                const mine = a.drafterId === rr.youId;
                return (
                  <div
                    key={`${a.drafterId}-${a.playerId}`}
                    className={`text-sm ${mine ? 'text-emerald-300 font-semibold' : 'text-slate-300'}`}
                  >
                    {p?.name}{' '}
                    <span className="text-slate-500">
                      → {mine ? 'you' : d?.name} ({SLOTS[a.slot]})
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {reveal.eliminations.length > 0 && (
            <div className="text-sm text-red-300">
              <span className="font-bold">🔥 Eliminated from the pool:</span>{' '}
              {reveal.eliminations
                .map((id) => BY_ID.get(id)?.name ?? id)
                .join(', ')}
            </div>
          )}
          {reveal.assignments.length === 0 && reveal.eliminations.length === 0 && (
            <div className="text-sm text-slate-400">No picks went through that round.</div>
          )}
        </Card>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
          Your starting five
        </div>
        <RosterSlots roster={myRoster} />
      </div>

      {!showPickers && submitted ? (
        <Card className="!p-3 text-center">
          <div className="text-sm font-semibold text-orange-300">
            🔒 Lineup locked in
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {submitted
              .map((p) => `${BY_ID.get(p.playerId)?.name} (${SLOTS[p.slot]})`)
              .join(' · ')}
          </div>
          <button
            onClick={startEdit}
            className="text-xs text-orange-400 font-semibold mt-2 underline"
          >
            Change lineup
          </button>
          <div className="text-xs text-slate-500 mt-1">
            Waiting for the reveal…
          </div>
        </Card>
      ) : (
        <>
          {emptySlots.map((slot) => (
            <div key={slot}>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                {SLOTS[slot]} — pick your {SLOTS[slot].toLowerCase()}
                {lineup[slot] && (
                  <span className="text-emerald-300 normal-case">
                    {' '}
                    · {BY_ID.get(lineup[slot])?.name}
                  </span>
                )}
              </div>
              <PlayerPicker
                players={availableForSlot(slot)}
                draftLabel="Select"
                onDraft={(p) => setLineup((l) => ({ ...l, [slot]: p.id }))}
              />
            </div>
          ))}
          <button
            onClick={submit}
            disabled={!complete}
            className={`w-full min-h-[52px] rounded-xl font-bold text-base transition ${
              complete
                ? 'bg-orange-500 text-slate-950 active:bg-orange-400'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {editing ? 'Update lineup' : 'Submit secret lineup'} ({filledCount}/
            {emptySlots.length})
          </button>
        </>
      )}
    </div>
  );
}
