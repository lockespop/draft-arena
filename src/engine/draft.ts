// Pure draft mechanics for both modes. Functions mutate the passed RoomState
// (the server owns the canonical copy and broadcasts it after each change).

import type {
  Drafter, FreeformReveal, Player, Position, RoomState,
} from '../shared/types';
import { SLOTS, SNAKE_ROUNDS, MAX_FREEFORM_ROUNDS } from '../shared/types';
import type { Rng } from './rng';

export function playersById(players: Player[]): Map<string, Player> {
  return new Map(players.map((p) => [p.id, p]));
}

/** Best slot index for a player given the current roster (prefers positional fit). */
export function slotForPlayer(player: Player, roster: (string | null)[]): number {
  const at = (pos: Position) => SLOTS.indexOf(pos);
  if (roster[at(player.pos)] === null) return at(player.pos);
  if (player.pos2 && roster[at(player.pos2)] === null) return at(player.pos2);
  return roster.findIndex((s) => s === null); // -1 when full
}

export function rosterFull(d: Drafter): boolean {
  return d.roster.every((s) => s !== null);
}

export function buildSnakeOrder(drafterIds: string[], rounds = SNAKE_ROUNDS): string[] {
  const order: string[] = [];
  for (let r = 0; r < rounds; r++) {
    order.push(...(r % 2 === 0 ? drafterIds : [...drafterIds].reverse()));
  }
  return order;
}

function drafterById(state: RoomState, id: string): Drafter | undefined {
  return state.drafters.find((d) => d.id === id);
}

function finishIfDone(state: RoomState): void {
  if (state.phase !== 'draft') return;
  if (state.drafters.every(rosterFull)) {
    state.phase = 'complete';
    state.pickDeadline = null;
  }
}

// ---------------------------------------------------------------------------
// Snake draft
// ---------------------------------------------------------------------------

export function currentSnakeDrafter(state: RoomState): Drafter | undefined {
  if (state.mode !== 'snake' || state.phase !== 'draft') return undefined;
  return drafterById(state, state.pickOrder[state.currentPick]);
}

/** Apply a snake pick. Returns null on success, or an error message. */
export function doSnakePick(
  state: RoomState,
  drafterId: string,
  playerId: string,
  byId: Map<string, Player>,
): string | null {
  const d = drafterById(state, drafterId);
  if (!d) return 'Drafter not found.';
  if (state.phase !== 'draft' || state.mode !== 'snake') return 'Draft is not running.';
  if (state.pickOrder[state.currentPick] !== drafterId) return 'Not your pick.';
  if (!state.pool.includes(playerId)) return 'Player is not available.';
  const player = byId.get(playerId);
  if (!player) return 'Unknown player.';
  const slot = slotForPlayer(player, d.roster);
  if (slot < 0) return 'Roster is full.';

  d.roster[slot] = playerId;
  state.pool = state.pool.filter((id) => id !== playerId);
  state.currentPick += 1;
  finishIfDone(state);
  return null;
}

/**
 * Auto-pick for timeouts/AFK: best available by positional need.
 * Returns the picked player id, or null if nothing to do.
 */
export function autoPickSnake(
  state: RoomState,
  drafterId: string,
  byId: Map<string, Player>,
  rng: Rng,
): string | null {
  const d = drafterById(state, drafterId);
  if (!d || state.phase !== 'draft' || state.mode !== 'snake') return null;
  if (state.pickOrder[state.currentPick] !== drafterId) return null;

  const emptySlots = d.roster
    .map((s, i) => (s === null ? SLOTS[i] : null))
    .filter((s): s is Position => s !== null);

  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const id of state.pool) {
    const p = byId.get(id);
    if (!p) continue;
    let score = p.ovr;
    if (emptySlots.includes(p.pos)) score += 10;
    else if (p.pos2 && emptySlots.includes(p.pos2)) score += 5;
    score += rng() * 3; // small jitter so bots aren't perfectly predictable
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) return null;
  const err = doSnakePick(state, drafterId, best.id, byId);
  return err ? null : best.id;
}

// ---------------------------------------------------------------------------
// Free-form draft
// ---------------------------------------------------------------------------

/** Drafters who still need players this round. */
export function activeDrafters(state: RoomState): Drafter[] {
  return state.drafters.filter((d) => !rosterFull(d));
}

/** Submit a hidden pick for the current free-form round. */
export function doFreeformSubmit(
  state: RoomState,
  drafterId: string,
  playerId: string,
  byId: Map<string, Player>,
): string | null {
  const d = drafterById(state, drafterId);
  if (!d) return 'Drafter not found.';
  if (state.phase !== 'draft' || state.mode !== 'freeform') return 'Draft is not running.';
  if (rosterFull(d)) return 'Your roster is full.';
  if (!state.pool.includes(playerId)) return 'Player is not available.';
  if (!byId.has(playerId)) return 'Unknown player.';
  state.submissions[drafterId] = playerId;
  return null;
}

export function freeformAllSubmitted(state: RoomState): boolean {
  return activeDrafters(state).every((d) => state.submissions[d.id] !== undefined);
}

/**
 * Reveal a free-form round: unique picks lock in, contested picks (2+ drafters)
 * are eliminated from the pool. Returns the reveal summary.
 */
export function resolveFreeformRound(state: RoomState, byId: Map<string, Player>): FreeformReveal {
  const counts = new Map<string, string[]>();
  for (const [drafterId, playerId] of Object.entries(state.submissions)) {
    const d = drafterById(state, drafterId);
    if (!d || rosterFull(d)) continue;
    if (!counts.has(playerId)) counts.set(playerId, []);
    counts.get(playerId)!.push(drafterId);
  }

  const reveal: FreeformReveal = { round: state.round, assignments: [], eliminations: [] };

  for (const [playerId, drafters] of counts) {
    const player = byId.get(playerId);
    if (!player) continue;
    if (drafters.length >= 2) {
      // Contested: eliminated, nobody gets them.
      reveal.eliminations.push(playerId);
      state.pool = state.pool.filter((id) => id !== playerId);
    } else {
      const d = drafterById(state, drafters[0])!;
      const slot = slotForPlayer(player, d.roster);
      if (slot >= 0) {
        d.roster[slot] = playerId;
        state.pool = state.pool.filter((id) => id !== playerId);
        reveal.assignments.push({ drafterId: d.id, playerId, slot });
      }
    }
  }

  state.lastReveal = reveal;
  state.submissions = {};
  state.round += 1;
  if (reveal.assignments.length === 0) state.roundsStalled += 1;
  else state.roundsStalled = 0;

  finishIfDone(state);
  return reveal;
}

/**
 * Safety valve: fills every incomplete roster with best-available-by-need.
 * Called after MAX_FREEFORM_ROUNDS or when the pool is nearly exhausted.
 */
export function freeformSafetyFill(state: RoomState, byId: Map<string, Player>): void {
  for (const d of activeDrafters(state)) {
    while (!rosterFull(d) && state.pool.length > 0) {
      const emptySlots = d.roster
        .map((s, i) => (s === null ? SLOTS[i] : null))
        .filter((s): s is Position => s !== null);
      let best: Player | null = null;
      let bestScore = -Infinity;
      for (const id of state.pool) {
        const p = byId.get(id);
        if (!p) continue;
        let score = p.ovr;
        if (emptySlots.includes(p.pos)) score += 10;
        else if (p.pos2 && emptySlots.includes(p.pos2)) score += 5;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) break;
      const slot = slotForPlayer(best, d.roster);
      if (slot < 0) break;
      d.roster[slot] = best.id;
      state.pool = state.pool.filter((id) => id !== best!.id);
    }
  }
  finishIfDone(state);
}

export function freeformNeedsSafetyFill(state: RoomState): boolean {
  if (state.mode !== 'freeform' || state.phase !== 'draft') return false;
  if (state.round > MAX_FREEFORM_ROUNDS) return true;
  const needed = activeDrafters(state).reduce(
    (n, d) => n + d.roster.filter((s) => s === null).length,
    0,
  );
  return state.pool.length < needed;
}
