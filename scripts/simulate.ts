// Engine simulation: runs full snake + free-form drafts headlessly with bots,
// asserting the core loop completes with valid rosters. Run: npm run simulate

import playersData from '../src/data/players.json';
import type { BotPersonality, Drafter, Player, RoomState } from '../src/shared/types';
import {
  activeDrafters,
  buildSnakeOrder,
  currentSnakeDrafter,
  doFreeformLineupSubmit,
  doSnakePick,
  freeformAllSubmitted,
  freeformNeedsSafetyFill,
  freeformSafetyFill,
  playersById,
  resolveFreeformRound,
  rosterFull,
} from '../src/engine/draft';
import { botChoose, botFreeformLineup } from '../src/engine/bots';
import { rankTeams } from '../src/engine/judge';
import { mulberry32, shuffled } from '../src/engine/rng';

const players = playersData as unknown as Player[];
const byId = playersById(players);

const PERSONALITIES: BotPersonality[] = ['bpa', 'needs', 'defense', 'stars', 'contrarian', 'bpa'];

function makeDrafters(n: number): Drafter[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    name: i === 0 ? 'HumanSim' : `Bot${i}`,
    isBot: i !== 0,
    personality: PERSONALITIES[i % PERSONALITIES.length],
    roster: [null, null, null, null, null],
    connected: true,
  }));
}

function baseState(mode: 'snake' | 'freeform', n: number, seed: number): RoomState {
  const rng = mulberry32(seed);
  const drafters = makeDrafters(n);
  return {
    roomId: 'SIM',
    mode,
    phase: 'draft',
    drafters,
    pool: shuffled(players.map((p) => p.id), rng),
    pickOrder: mode === 'snake' ? buildSnakeOrder(drafters.map((d) => d.id)) : [],
    currentPick: 0,
    round: 1,
    submissions: {},
    lastReveal: null,
    roundsStalled: 0,
    pickDeadline: null,
    createdAt: Date.now(),
    winnerId: null,
  };
}

function availablePlayers(s: RoomState): Player[] {
  const out: Player[] = [];
  for (const id of s.pool) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
}

function validateFinal(s: RoomState, label: string): void {
  assert(s.phase === 'complete', `${label}: phase should be complete`);
  const seen = new Set<string>();
  for (const d of s.drafters) {
    assert(rosterFull(d), `${label}: ${d.name} roster not full`);
    for (const id of d.roster) {
      assert(id !== null, `${label}: null slot`);
      assert(!seen.has(id!), `${label}: duplicate player ${id}`);
      seen.add(id!);
    }
  }
  console.log(`✅ ${label}: ${s.drafters.length} teams × 5, no dupes, all slots filled`);
}

// --- Snake ---
{
  const rng = mulberry32(42);
  const s = baseState('snake', 6, 42);
  let picks = 0;
  while (s.phase === 'draft' && picks < 200) {
    const cur = currentSnakeDrafter(s);
    assert(!!cur, 'snake: no current drafter');
    const choice = botChoose(availablePlayers(s), cur!, cur!.personality ?? 'bpa', rng);
    assert(!!choice, 'snake: bot found no pick');
    const err = doSnakePick(s, cur!.id, choice!.id, byId);
    assert(!err, `snake pick error: ${err}`);
    picks++;
  }
  assert(picks === 30, `snake: expected 30 picks, got ${picks}`);
  validateFinal(s, `snake draft (${picks} picks)`);
}

// --- Free-form ---
{
  const rng = mulberry32(7);
  const s = baseState('freeform', 6, 7);
  let totalEliminated = 0;
  let totalLocked = 0;
  const eliminatedEver = new Set<string>();
  let guard = 0;
  while (s.phase === 'draft' && guard < 60) {
    guard++;
    for (const d of activeDrafters(s)) {
      const empty = d.roster.filter((x) => x === null).length;
      const lineup = botFreeformLineup(availablePlayers(s), d, d.personality ?? 'bpa', rng);
      assert(
        lineup.length === empty,
        `freeform: lineup covers ${lineup.length}/${empty} slots for ${d.name}`,
      );
      const err = doFreeformLineupSubmit(s, d.id, lineup, byId);
      assert(!err, `freeform submit error: ${err}`);
    }
    assert(freeformAllSubmitted(s), 'freeform: not all submitted');
    const reveal = resolveFreeformRound(s);
    totalEliminated += reveal.eliminations.length;
    totalLocked += reveal.assignments.length;
    for (const id of reveal.eliminations) eliminatedEver.add(id);
    if (freeformNeedsSafetyFill(s, byId)) freeformSafetyFill(s, byId);
  }
  assert(s.phase === 'complete', 'freeform: did not terminate');
  // Eliminated players must never end up locked in a roster.
  for (const d of s.drafters) {
    for (const id of d.roster) {
      assert(
        id !== null && !eliminatedEver.has(id!),
        `freeform: eliminated player ${id} in ${d.name}'s roster`,
      );
    }
  }
  validateFinal(
    s,
    `free-form draft (${s.round - 1} rounds, ${totalLocked} locked, ${totalEliminated} eliminated)`,
  );
}

// --- Judge sanity ---
{
  const s = baseState('snake', 4, 99);
  const rng = mulberry32(99);
  let picks = 0;
  while (s.phase === 'draft' && picks < 100) {
    const cur = currentSnakeDrafter(s)!;
    const choice = botChoose(availablePlayers(s), cur, cur.personality ?? 'bpa', rng)!;
    doSnakePick(s, cur.id, choice.id, byId);
    picks++;
  }
  const ranked = rankTeams(s.drafters, byId);
  assert(ranked.length === 4, 'judge: ranked 4 teams');
  assert(ranked[0].total >= ranked[3].total, 'judge: sorted desc');
  console.log('✅ judge ranking OK — winner:', ranked[0].name, `(score ${Math.round(ranked[0].total)})`);
}

console.log(`\nAll simulations passed. Player pool: ${players.length}`);
