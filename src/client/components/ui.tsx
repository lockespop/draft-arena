import { useEffect, useMemo, useState } from 'react';
import type { Player, Position } from '../../shared/types';
import { PICK_SECONDS, SLOTS } from '../../shared/types';

// ---------------------------------------------------------------------------
// Buttons & cards
// ---------------------------------------------------------------------------

export function Btn({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const base =
    'min-h-[48px] px-5 rounded-xl font-semibold text-base transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100';
  const styles =
    variant === 'primary'
      ? 'bg-orange-500 text-slate-950 hover:bg-orange-400'
      : variant === 'danger'
        ? 'bg-red-900/60 text-red-200 border border-red-800'
        : 'bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700';
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

export function OvrBadge({ ovr }: { ovr: number }) {
  const color =
    ovr >= 95
      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
      : ovr >= 90
        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
        : ovr >= 85
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
          : 'bg-slate-500/20 text-slate-300 border-slate-500/40';
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[44px] px-1.5 py-0.5 rounded-lg border text-sm font-bold ${color}`}
    >
      {ovr}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Roster slots
// ---------------------------------------------------------------------------

export function RosterSlots({
  roster,
  pending,
  onClearSlot,
}: {
  roster: (Player | null)[];
  /** slot indexes whose pick is tentative (chosen but not yet finalized) */
  pending?: boolean[];
  /** tapping a pending slot clears it (lets the user change their mind) */
  onClearSlot?: (slot: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {SLOTS.map((pos, i) => {
        const p = roster[i] ?? null;
        const isPending = !!pending?.[i] && !!p;
        return (
          <div
            key={pos}
            onClick={isPending && onClearSlot ? () => onClearSlot(i) : undefined}
            className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${
              isPending
                ? 'bg-orange-500/5 border-orange-400/60 border-dashed cursor-pointer active:bg-orange-500/10'
                : p
                  ? 'bg-slate-800/80 border-slate-700'
                  : 'bg-slate-900/60 border-slate-800 border-dashed'
            }`}
          >
            <span className="w-8 text-xs font-bold text-slate-400">{pos}</span>
            {p ? (
              <>
                <span
                  className={`flex-1 text-sm font-medium truncate ${isPending ? 'text-slate-300' : ''}`}
                >
                  {p.name}
                </span>
                {isPending && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-orange-300/90">
                    pending
                  </span>
                )}
                <OvrBadge ovr={p.ovr} />
              </>
            ) : (
              <span className="text-sm text-slate-600">Empty</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pick timer
// ---------------------------------------------------------------------------

export function TimerBar({
  deadline,
  totalSeconds = PICK_SECONDS,
  big = false,
  label = 'Time to pick',
}: {
  deadline: number | null;
  /** full length of the countdown, for the progress bar math */
  totalSeconds?: number;
  /** prominent rendering for long free-form rounds */
  big?: boolean;
  label?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);

  if (!deadline) return null;
  const left = Math.max(0, deadline - now);
  const pct = Math.min(100, (left / (totalSeconds * 1000)) * 100);
  const secs = Math.ceil(left / 1000);
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  const clock = mins > 0 ? `${mins}:${String(rem).padStart(2, '0')}` : `${secs}s`;
  const urgent = secs <= 15;

  return (
    <div className="w-full">
      <div className="flex justify-between items-baseline text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span
          className={`font-extrabold tabular-nums ${big ? 'text-2xl' : ''} ${
            urgent ? 'text-red-400' : 'text-slate-100'
          }`}
        >
          {clock}
        </span>
      </div>
      <div className={`${big ? 'h-3' : 'h-2'} rounded-full bg-slate-800 overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all ${urgent ? 'bg-red-500' : 'bg-orange-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player picker (search + position filter + select)
// ---------------------------------------------------------------------------

const POS_FILTERS: ('ALL' | Position)[] = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];
const PAGE = 60;

export function PlayerPicker({
  players,
  onDraft,
  draftLabel,
  disabled = false,
}: {
  players: Player[];
  onDraft: (p: Player) => void;
  draftLabel: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<'ALL' | Position>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (pos !== 'ALL' && p.pos !== pos && p.pos2 !== pos) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [players, query, pos]);

  const selected = selectedId ? (players.find((p) => p.id === selectedId) ?? null) : null;

  useEffect(() => {
    setVisible(PAGE);
  }, [query, pos, players.length]);

  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search players…"
        className="w-full min-h-[48px] px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 outline-none focus:border-orange-500"
      />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {POS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setPos(f)}
            className={`px-3.5 py-2 rounded-full text-sm font-semibold whitespace-nowrap border ${
              pos === f
                ? 'bg-orange-500 text-slate-950 border-orange-500'
                : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="nice-scroll flex flex-col gap-1.5 max-h-[46vh] overflow-y-auto pr-1">
        {filtered.slice(0, visible).map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(active ? null : p.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition ${
                active
                  ? 'bg-orange-500/15 border-orange-500'
                  : 'bg-slate-900 border-slate-800 active:bg-slate-800'
              }`}
            >
              <OvrBadge ovr={p.ovr} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{p.name}</span>
                <span className="block text-xs text-slate-400">
                  {p.pos}
                  {p.pos2 ? `/${p.pos2}` : ''} · {p.era} · {p.ppg}/{p.rpg}/{p.apg}
                </span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center text-slate-500 py-8 text-sm">No players match.</div>
        )}
      </div>
      {visible < filtered.length && (
        <button
          onClick={() => setVisible((v) => v + PAGE)}
          className="text-sm text-orange-400 font-semibold py-2"
        >
          Show more ({filtered.length - visible} left)
        </button>
      )}

      {selected && (
        <div className="sticky bottom-0 pt-2">
          <Btn
            onClick={() => {
              onDraft(selected);
              setSelectedId(null);
            }}
            disabled={disabled}
            className="w-full"
          >
            {draftLabel}: {selected.name} ({selected.ovr})
          </Btn>
        </div>
      )}
    </div>
  );
}
