import raw from '../data/players.json';
import type { Player } from '../shared/types';

export const PLAYERS = raw as unknown as Player[];
export const BY_ID = new Map<string, Player>(PLAYERS.map((p) => [p.id, p]));
export const SORTED_BY_OVR = [...PLAYERS].sort((a, b) => b.ovr - a.ovr);
