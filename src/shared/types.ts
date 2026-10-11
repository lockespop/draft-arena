// Shared types for Draft Arena — used by engine, server, and client.

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

/** Roster slot order: index 0=PG, 1=SG, 2=SF, 3=PF, 4=C */
export const SLOTS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export interface Attributes {
  sco: number; // scoring
  def: number; // defense
  ply: number; // playmaking
  reb: number; // rebounding
  ath: number; // athleticism
  sho: number; // shooting
}

export interface Player {
  id: string;
  name: string;
  pos: Position;
  pos2: Position | null;
  era: string;
  ppg: number;
  rpg: number;
  apg: number;
  acc: string[];
  attr: Attributes;
  ovr: number;
}

export type BotPersonality = 'bpa' | 'needs' | 'defense' | 'stars' | 'contrarian';

export const BOT_LABELS: Record<BotPersonality, string> = {
  bpa: 'Best Available',
  needs: 'Positional Needs',
  defense: 'Defense First',
  stars: 'Star Chaser',
  contrarian: 'Contrarian',
};

export const BOT_PERSONALITIES = Object.keys(BOT_LABELS) as BotPersonality[];

export interface Drafter {
  id: string;
  name: string;
  isBot: boolean;
  personality: BotPersonality | null;
  /** player ids per slot index (0=PG..4=C), null = empty */
  roster: (string | null)[];
  connected: boolean;
}

export type DraftMode = 'snake' | 'freeform';
export type RoomPhase = 'lobby' | 'draft' | 'complete';

export interface FreeformAssignment {
  drafterId: string;
  playerId: string;
  slot: number;
}

/** One secret pick within a free-form lineup submission. */
export interface FreeformPick {
  /** roster slot index (0=PG..4=C) */
  slot: number;
  playerId: string;
}

export interface FreeformReveal {
  round: number;
  assignments: FreeformAssignment[];
  /** player ids picked by 2+ drafters — eliminated, nobody gets them */
  eliminations: string[];
}

export interface RoomState {
  roomId: string;
  mode: DraftMode;
  phase: RoomPhase;
  drafters: Drafter[];
  /** available player ids */
  pool: string[];
  // snake draft
  pickOrder: string[];
  currentPick: number;
  // free-form draft
  round: number;
  /** hidden lineups: drafterId -> one pick per empty slot */
  submissions: Record<string, FreeformPick[]>;
  /** tentative (unfinalized) picks, synced live as humans tap: drafterId -> picks.
   *  Kept secret from other clients until the reveal; finalized at deadline. */
  tentative: Record<string, FreeformPick[]>;
  lastReveal: FreeformReveal | null;
  roundsStalled: number;
  /** epoch ms when the current pick/round auto-resolves, null when none */
  pickDeadline: number | null;
  createdAt: number;
  winnerId: string | null;
}

/** Messages client -> server */
export type ClientMessage =
  | { t: 'create'; name: string; mode: DraftMode }
  | { t: 'join'; roomId: string; name: string }
  | { t: 'addBot'; personality?: BotPersonality }
  | { t: 'removeDrafter'; drafterId: string }
  | { t: 'start' }
  | { t: 'pick'; playerId: string }
  | { t: 'submit'; picks: FreeformPick[] }
  | { t: 'lineup_update'; picks: FreeformPick[] };

/** Messages server -> client */
export interface ClientRoomView extends RoomState {
  /** number of drafters who have submitted this free-form round */
  submittedCount: number;
}

export type ServerMessage =
  | { t: 'state'; state: ClientRoomView; youId: string | null }
  | { t: 'error'; message: string };

export const SNAKE_ROUNDS = 5;
export const PICK_SECONDS = 60;
/** Free-form rounds get a longer deadline: picking up to 5 players takes longer. */
export const FREEFORM_SECONDS = 180;
/** Free-form safety valve: after this many rounds, auto-fill incomplete rosters */
export const MAX_FREEFORM_ROUNDS = 15;
export const MIN_DRAFTERS = 1;
export const MAX_DRAFTERS = 12;
