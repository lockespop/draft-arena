// Pure draft mechanics for both modes. Functions mutate the passed RoomState
// (the server owns the canonical copy and broadcasts it after each change).

import type {
  Drafter, FreeformPick, FreeformReveal, Player, Position, RoomState,
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

/** Submit a hidden lineup for the current free-form round: one pick per empty
 * roster slot. Returns null on success, or an error message. */
export function doFreeformLineupSubmit(
  state: RoomState,
  drafterId: string,
  picks: FreeformPick[],
  byId: Map<string, Player>,
): string | null {
  const d = drafterById(state, drafterId);
  if (!d) return 'Drafter not found.';
  if (state.phase !== 'draft' || state.mode !== 'freeform') return 'Draft is not running.';
  if (rosterFull(d)) return 'Your roster is full.';
  const emptyCount = d.roster.filter((s) => s === null).length;
  if (!Array.isArray(picks) || picks.length !== emptyCount) {
    return `Submit one pick per empty slot (${emptyCount}).`;
  }
  const seenSlots = new Set<number>();
  const seenPlayers = new Set<string>();
  for (const pick of picks) {
    const err = validateFreeformPick(state, d, pick, byId, seenSlots, seenPlayers);
    if (err) return err;
  }
  state.submissions[drafterId] = picks;
  return null;
}

/**
 * Validate one free-form pick (shared by submit + tentative update).
 * Tracks seen slots/players in the caller's sets so duplicates across the
 * pick list are caught.
 */
function validateFreeformPick(
  state: RoomState,
  d: Drafter,
  pick: FreeformPick,
  byId: Map<string, Player>,
  seenSlots: Set<number>,
  seenPlayers: Set<string>,
): string | null {
  if (!pick || !Number.isInteger(pick.slot) || pick.slot < 0 || pick.slot >= SLOTS.length) {
    return 'Invalid slot.';
  }
  if (d.roster[pick.slot] !== null) return 'That slot is already filled.';
  if (seenSlots.has(pick.slot)) return 'Two picks for the same slot.';
  if (seenPlayers.has(pick.playerId)) return 'Two slots picked the same player.';
  if (!state.pool.includes(pick.playerId)) return 'Player is not available.';
  const player = byId.get(pick.playerId);
  if (!player) return 'Unknown player.';
  const pos = SLOTS[pick.slot];
  if (player.pos !== pos && player.pos2 !== pos) {
    return `${player.name} can't play ${pos}.`;
  }
  seenSlots.add(pick.slot);
  seenPlayers.add(pick.playerId);
  return null;
}

/**
 * Store a drafter's tentative (unfinalized) free-form picks, synced live as
 * they tap. Partial coverage is allowed — picks are validated the same way
 * as a final submission. Kept in state.tentative, never broadcast to others.
 */
export function doFreeformLineupUpdate(
  state: RoomState,
  drafterId: string,
  picks: FreeformPick[],
  byId: Map<string, Player>,
): string | null {
  const d = drafterById(state, drafterId);
  if (!d) return 'Drafter not found.';
  if (state.phase !== 'draft' || state.mode !== 'freeform') return 'Draft is not running.';
  if (rosterFull(d)) return 'Your roster is full.';
  if (!Array.isArray(picks)) return 'Bad picks.';
  const emptyCount = d.roster.filter((s) => s === null).length;
  if (picks.length > emptyCount) return 'Too many picks.';
  const seenSlots = new Set<number>();
  const seenPlayers = new Set<string>();
  for (const pick of picks) {
    const err = validateFreeformPick(state, d, pick, byId, seenSlots, seenPlayers);
    if (err) return err;
  }
  state.tentative[drafterId] = picks;
  return null;
}

/**
 * Deadline finalize for a drafter who never submitted: re-validate their
 * tentative picks (dropping any that no longer fit), keep the valid ones,
 * and auto-fill ONLY the remaining empty slots needs-based (best overall
 * rating that fits the slot). Stores a full submission. Returns null on
 * success, or an error message (caller falls back to the safety valve).
 */
export function finalizeTentativeLineup(
  state: RoomState,
  drafterId: string,
  byId: Map<string, Player>,
  rng: Rng,
): string | null {
  const d = drafterById(state, drafterId);
  if (!d) return 'Drafter not found.';
  if (state.phase !== 'draft' || state.mode !== 'freeform') return 'Draft is not running.';
  if (rosterFull(d)) {
    delete state.tentative[drafterId];
    return null;
  }
  // Re-validate tentative picks one by one, keeping whatever still fits.
  const valid: FreeformPick[] = [];
  const seenSlots = new Set<number>();
  const seenPlayers = new Set<string>();
  for (const pick of state.tentative[drafterId] ?? []) {
    if (!validateFreeformPick(state, d, pick, byId, seenSlots, seenPlayers)) {
      valid.push(pick);
    }
  }
  // Auto-fill only the slots still empty, needs-based.
  const pool = state.pool;
  for (let slot = 0; slot < SLOTS.length; slot++) {
    if (d.roster[slot] !== null || seenSlots.has(slot)) continue;
    const pos = SLOTS[slot];
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const id of pool) {
      if (seenPlayers.has(id)) continue;
      const p = byId.get(id);
      if (!p) continue;
      if (p.pos !== pos && p.pos2 !== pos) continue;
      const score = p.ovr + rng() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) {
      valid.push({ slot, playerId: best.id });
      seenSlots.add(slot);
      seenPlayers.add(best.id);
    }
  }
  delete state.tentative[drafterId];
  return doFreeformLineupSubmit(state, drafterId, valid, byId);
}

export function freeformAllSubmitted(state: RoomState): boolean {
  return activeDrafters(state).every((d) => {
    const sub = state.submissions[d.id];
    return Array.isArray(sub) && sub.length > 0;
  });
}

/**
 * Reveal a free-form round: players picked by exactly one drafter lock into
 * that drafter's roster at their chosen slot; players picked by 2+ drafters
 * are eliminated from the pool entirely. Returns the reveal summary.
 */
export function resolveFreeformRound(state: RoomState): FreeformReveal {
  // Count picks per player across the round (only drafters still building).
  const pickedBy = new Map<string, string[]>();
  const pickSlot = new Map<string, Map<string, number>>(); // playerId -> drafterId -> slot
  for (const [drafterId, picks] of Object.entries(state.submissions)) {
    const d = drafterById(state, drafterId);
    if (!d || rosterFull(d) || !Array.isArray(picks)) continue;
    for (const pick of picks) {
      if (!pickedBy.has(pick.playerId)) {
        pickedBy.set(pick.playerId, []);
        pickSlot.set(pick.playerId, new Map());
      }
      pickedBy.get(pick.playerId)!.push(drafterId);
      pickSlot.get(pick.playerId)!.set(drafterId, pick.slot);
    }
  }

  const reveal: FreeformReveal = { round: state.round, assignments: [], eliminations: [] };

  for (const [playerId, drafterIds] of pickedBy) {
    if (drafterIds.length >= 2) {
      // Contested: eliminated from the pool entirely, nobody gets them.
      reveal.eliminations.push(playerId);
      state.pool = state.pool.filter((id) => id !== playerId);
      continue;
    }
    const drafterId = drafterIds[0];
    const d = drafterById(state, drafterId);
    const slot = pickSlot.get(playerId)!.get(drafterId)!;
    if (!d || d.roster[slot] !== null) continue; // defensive; shouldn't happen
    d.roster[slot] = playerId;
    state.pool = state.pool.filter((id) => id !== playerId);
    reveal.assignments.push({ drafterId, playerId, slot });
  }

  state.lastReveal = reveal;
  state.submissions = {};
  state.tentative = {};
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

export function freeformNeedsSafetyFill(
  state: RoomState,
  byId: Map<string, Player>,
): boolean {
  if (state.mode !== 'freeform' || state.phase !== 'draft') return false;
  if (state.round > MAX_FREEFORM_ROUNDS) return true;
  const active = activeDrafters(state);
  const needed = active.reduce(
    (n, d) => n + d.roster.filter((s) => s === null).length,
    0,
  );
  if (state.pool.length < needed) return true;
  // Position deadlock: an empty slot with no fitting player left in the pool
  // (e.g. every remaining PG was eliminated) can never be filled by a lineup.
  const poolPlayers: Player[] = [];
  for (const id of state.pool) {
    const p = byId.get(id);
    if (p) poolPlayers.push(p);
  }
  for (const d of active) {
    for (let i = 0; i < SLOTS.length; i++) {
      if (d.roster[i] !== null) continue;
      const pos = SLOTS[i];
      const fits = poolPlayers.some((p) => p.pos === pos || p.pos2 === pos);
      if (!fits) return true;
    }
  }
  return false;
}
