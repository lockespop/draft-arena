// Computer-opponent draft personalities. Each bot scores available players
// differently and picks with weighted randomness, so games feel different
// and bots are beatable but not brain-dead.

import type { BotPersonality, Drafter, FreeformPick, Player, Position } from '../shared/types';
import { SLOTS } from '../shared/types';
import type { Rng } from './rng';
import { weightedIndex } from './rng';

const BOT_NAMES = [
  'Coach CPU', 'GM Bot', 'The Algorithm', 'DraftNite', 'Stat Head',
  'Moneyball', 'Pick Wizard', 'RosterBot', 'The Scout', 'Clip Board',
  'Sixth Man', 'Full Court',
];

export function randomBotName(rng: Rng, used: Set<string>): string {
  const options = BOT_NAMES.filter((n) => !used.has(n));
  const pool = options.length > 0 ? options : BOT_NAMES;
  return pool[Math.floor(rng() * pool.length)];
}

function emptySlots(d: Drafter): Position[] {
  return d.roster
    .map((s, i) => (s === null ? SLOTS[i] : null))
    .filter((s): s is Position => s !== null);
}

/** Personality scoring: higher = more desirable for this bot. */
export function botScore(p: Player, d: Drafter, personality: BotPersonality): number {
  const need = emptySlots(d);
  const needBonus =
    need.includes(p.pos) ? 10 : p.pos2 && need.includes(p.pos2) ? 5 : 0;

  switch (personality) {
    case 'bpa':
      return p.ovr + needBonus * 0.5;
    case 'needs':
      return p.ovr + needBonus * 1.6;
    case 'defense':
      return p.attr.def * 0.55 + p.attr.reb * 0.25 + p.ovr * 0.2 + needBonus;
    case 'stars':
      // Chases elite talent; settles for solid players only reluctantly.
      return (p.ovr >= 92 ? p.ovr + 25 : p.ovr * 0.85) + needBonus * 0.3;
    case 'contrarian':
      // Likes good-not-obvious picks; positional fit matters a bit.
      return p.ovr * 0.95 + needBonus;
  }
}

/**
 * Choose a player id for a bot. Weighted random among the top candidates
 * so bots differ game to game. Contrarians ignore the top-3 consensus.
 */
export function botChoose(
  available: Player[],
  d: Drafter,
  personality: BotPersonality,
  rng: Rng,
): Player | null {
  if (available.length === 0) return null;
  const scored = available
    .map((p) => ({ p, s: botScore(p, d, personality) + rng() * 4 }))
    .sort((a, b) => b.s - a.s);

  let candidates = scored.slice(0, 5);
  if (personality === 'contrarian' && scored.length > 6) {
    // Deliberately dodge the obvious top picks.
    candidates = scored.slice(3, 9);
  }
  const weights = candidates.map((_, i) => candidates.length - i);
  return candidates[weightedIndex(weights, rng)].p;
}

/** Random personality, slightly weighted toward the more sensible ones. */
export function randomPersonality(rng: Rng): BotPersonality {
  const bag: BotPersonality[] = ['bpa', 'bpa', 'needs', 'needs', 'defense', 'stars', 'contrarian'];
  return bag[Math.floor(rng() * bag.length)];
}

/**
 * Build a full free-form lineup: one pick per empty slot. Honors personality,
 * with game-theory variance: sometimes takes the obvious star at a slot
 * (risking a contested elimination), usually spreads picks so the lineup
 * survives the reveal. May return fewer picks than empty slots when the pool
 * has no fitting player for a slot (the safety valve resolves that).
 */
export function botFreeformLineup(
  available: Player[],
  d: Drafter,
  personality: BotPersonality,
  rng: Rng,
): FreeformPick[] {
  const picks: FreeformPick[] = [];
  const taken = new Set<string>();
  const emptyIdx = d.roster
    .map((s, i) => (s === null ? i : -1))
    .filter((i) => i >= 0);

  // How likely this bot is to take the obvious best player at a slot.
  const starHunger =
    personality === 'stars' ? 0.45 : personality === 'contrarian' ? 0.08 : 0.22;

  for (const slot of emptyIdx) {
    const pos = SLOTS[slot];
    const fits = available.filter(
      (p) => !taken.has(p.id) && (p.pos === pos || p.pos2 === pos),
    );
    if (fits.length === 0) break;
    let choice: Player;
    if (rng() < starHunger) {
      // Take the best available at this slot — may collide and get eliminated.
      choice = fits.reduce((a, b) => (b.ovr > a.ovr ? b : a));
    } else {
      const scored = fits
        .map((p) => ({ p, s: botScore(p, d, personality) + rng() * 6 }))
        .sort((a, b) => b.s - a.s);
      const candidates = scored.slice(0, Math.min(8, scored.length));
      const weights = candidates.map((_, i) => candidates.length - i);
      choice = candidates[weightedIndex(weights, rng)].p;
    }
    taken.add(choice.id);
    picks.push({ slot, playerId: choice.id });
  }
  return picks;
}
