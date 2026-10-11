import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomHandle } from '../hooks/useRoom';
import type { ClientRoomView, FreeformPick } from '../../shared/types';
import { FREEFORM_SECONDS, SLOTS } from '../../shared/types';
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

  // This round's lineup attempt: slot index -> playerId (tentative until submitted)
  const [lineup, setLineup] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState(false);
  // New round -> fresh lineup.
  useEffect(() => {
    setLineup({});
    setEditing(false);
  }, [state.round]);

  const submitted: FreeformPick[] | undefined =
    rr.youId ? state.submissions[rr.youId] : undefined;
  const showPickers = !submitted || editing;

  // Sync tentative picks to the server as they're made (debounced), so a
  // deadline never discards what the user already chose. The server keeps
  // them secret from other drafters until the reveal. Skips sends when the
  // picks haven't actually changed (server broadcasts re-render often).
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<string>('');
  useEffect(() => {
    if (!showPickers || state.phase !== 'draft') return;
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      const picks: FreeformPick[] = emptySlots
        .filter((slot) => lineup[slot])
        .map((slot) => ({ slot, playerId: lineup[slot] }));
      const sig = JSON.stringify(picks);
      if (sig === lastSentRef.current) return;
      lastSentRef.current = sig;
      rr.send({ t: 'lineup_update', picks });
    }, 300);
    return () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
    };
  }, [lineup, showPickers, state.phase, emptySlots, rr]);

  // Roster display: locked picks solid, tentative picks shown immediately
  // with a "pending" treatment until they're submitted and revealed.
  const displayRoster = useMemo(() => {
    const base = me
      ? me.roster.map((id) => (id ? (BY_ID.get(id) ?? null) : null))
      : [];
    const pending = [false, false, false, false, false];
    for (const [slotStr, pid] of Object.entries(lineup)) {
      const slot = Number(slotStr);
      const p = BY_ID.get(pid);
      if (p && !base[slot]) {
        base[slot] = p;
        pending[slot] = true;
      }
    }
    return { base, pending };
  }, [me, lineup]);

  const clearSlot = (slot: number) => {
    setLineup((l) => {
      const n = { ...l };
      delete n[slot];
      return n;
    });
  };

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
        <TimerBar
          deadline={state.pickDeadline}
          totalSeconds={FREEFORM_SECONDS}
          big
          label="Round ends in"
        />
        <p className="text-xs text-slate-400 mt-2">
          Build your starting five in secret — one player per open slot. Your picks
          appear on your roster right away and save as you tap, so the buzzer
          never wipes them out. If 2+ drafters pick the same player, that player
          is <span className="text-red-400 font-semibold">eliminated</span> —
          nobody gets them. Unique picks lock into your roster. Fill your five
          and you sit out.
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
            <div className="text-sm text-red-300 mb-1.5">
              <span className="font-bold">🔥 Eliminated from the pool:</span>{' '}
              {reveal.eliminations
                .map((id) => BY_ID.get(id)?.name ?? id)
                .join(', ')}
            </div>
          )}
          {reveal.assignments.length === 0 && reveal.eliminations.length === 0 && (
            <div className="text-sm text-slate-400 mb-1.5">No picks went through that round.</div>
          )}
          <div className="pt-2 border-t border-slate-800">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">
              League progress
            </div>
            {state.drafters.map((d) => (
              <div key={d.id} className="mb-1.5">
                <div
                  className={`text-xs font-semibold ${d.id === rr.youId ? 'text-orange-300' : 'text-slate-300'}`}
                >
                  {d.id === rr.youId ? `${d.name} (you)` : d.name}
                </div>
                <div className="text-xs text-slate-500 leading-relaxed">
                  {SLOTS.map((pos, i) => {
                    const pid = d.roster[i];
                    const nm = pid ? (BY_ID.get(pid)?.name ?? '?') : '—';
                    return (
                      <span key={pos}>
                        <span className="text-slate-600">{pos}:</span> {nm}
                        {i < SLOTS.length - 1 ? ' · ' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
          Your starting five
        </div>
        <RosterSlots
          roster={displayRoster.base}
          pending={displayRoster.pending}
          onClearSlot={showPickers ? clearSlot : undefined}
        />
        <div className="text-[11px] text-slate-500 mt-1">
          Tap a pending pick to change it before you submit.
        </div>
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
                draftLabel="Draft"
                onDraft={(p) => setLineup((l) => ({ ...l, [slot]: p.id }))}
              />
            </div>
          ))}
          {complete && (
            <button
              onClick={submit}
              className="w-full min-h-[52px] rounded-xl font-bold text-base transition bg-orange-500 text-slate-950 active:bg-orange-400"
            >
              {editing ? 'Update lineup' : 'Submit lineup'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
