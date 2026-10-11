// Draft Arena game server: authoritative room state over WebSockets.
// In-memory rooms. Run with: npm run dev:server  (tsx src/server/index.ts)

import { WebSocketServer, WebSocket } from 'ws';
import { customAlphabet } from 'nanoid';
import playersData from '../data/players.json';
import type {
  BotPersonality, ClientMessage, ClientRoomView, Drafter, Player,
  RoomState, ServerMessage,
} from '../shared/types';
import { MAX_DRAFTERS, PICK_SECONDS, SNAKE_ROUNDS } from '../shared/types';
import {
  activeDrafters, autoPickSnake, buildSnakeOrder,
  currentSnakeDrafter, doFreeformSubmit, doSnakePick, freeformAllSubmitted,
  freeformNeedsSafetyFill, freeformSafetyFill, playersById, resolveFreeformRound,
  rosterFull,
} from '../engine/draft';
import { botChoose, randomBotName, randomPersonality } from '../engine/bots';
import { rankTeams } from '../engine/judge';
import { mulberry32, randomSeed, shuffled } from '../engine/rng';
import type { Rng } from '../engine/rng';

const players = playersData as unknown as Player[];
const byId = playersById(players);
const genRoomId = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6);
const genId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10);

const PORT = Number(process.env.PORT || 3001);
const BOT_DELAY_MIN = Number(process.env.BOT_DELAY_MIN || 1200);
const BOT_DELAY_MAX = Number(process.env.BOT_DELAY_MAX || 2800);
const PICK_SECS = Number(process.env.PICK_SECONDS || PICK_SECONDS);

interface Room {
  state: RoomState;
  /** socket -> drafterId (null until joined) */
  clients: Map<WebSocket, string | null>;
  deadline: NodeJS.Timeout | null;
  botTimer: NodeJS.Timeout | null;
  rng: Rng;
  lastActivity: number;
}

const rooms = new Map<string, Room>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newRoom(mode: RoomState['mode']): RoomState {
  return {
    roomId: genRoomId(),
    mode,
    phase: 'lobby',
    drafters: [],
    pool: [],
    pickOrder: [],
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

function viewFor(room: Room, youId: string | null): ClientRoomView {
  const s = room.state;
  const submissions: Record<string, string> = {};
  if (youId && s.submissions[youId]) submissions[youId] = s.submissions[youId];
  return { ...s, submissions, submittedCount: Object.keys(s.submissions).length };
}

function broadcast(room: Room): void {
  for (const [ws, youId] of room.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const msg: ServerMessage = { t: 'state', state: viewFor(room, youId), youId };
    ws.send(JSON.stringify(msg));
  }
}

function sendError(ws: WebSocket, message: string): void {
  const msg: ServerMessage = { t: 'error', message };
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function clearDeadline(room: Room): void {
  if (room.deadline) {
    clearTimeout(room.deadline);
    room.deadline = null;
  }
}

function clearBotTimer(room: Room): void {
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
}

/** Schedule a bot action; never touches the pick deadline. */
function scheduleBot(room: Room, ms: number, fn: () => void): void {
  clearBotTimer(room);
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    fn();
  }, ms);
}

function armDeadline(room: Room): void {
  const s = room.state;
  clearDeadline(room);
  if (s.phase !== 'draft') return;
  s.pickDeadline = Date.now() + PICK_SECS * 1000;
  room.lastActivity = Date.now();
  room.deadline = setTimeout(() => {
    room.deadline = null;
    onDeadline(room);
  }, PICK_SECS * 1000);
}

function botDelay(rng: Rng): number {
  return BOT_DELAY_MIN + rng() * (BOT_DELAY_MAX - BOT_DELAY_MIN);
}

function availablePlayers(s: RoomState): Player[] {
  const out: Player[] = [];
  for (const id of s.pool) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Draft flow
// ---------------------------------------------------------------------------

function startDraft(room: Room): string | null {
  const s = room.state;
  if (s.phase !== 'lobby') return 'Draft already started.';
  if (s.drafters.length < 1) return 'Need at least one drafter.';
  if (s.drafters.length > MAX_DRAFTERS) return 'Too many drafters (max 12).';

  s.pool = shuffled(players.map((p) => p.id), room.rng);
  s.phase = 'draft';
  s.round = 1;
  s.submissions = {};
  s.lastReveal = null;
  s.roundsStalled = 0;
  s.winnerId = null;

  if (s.mode === 'snake') {
    const ids = shuffled(s.drafters.map((d) => d.id), room.rng);
    s.pickOrder = buildSnakeOrder(ids, SNAKE_ROUNDS);
    s.currentPick = 0;
  }

  armDeadline(room);
  nudgeBots(room);
  return null;
}

function finishDraft(room: Room): void {
  const s = room.state;
  clearDeadline(room);
  clearBotTimer(room);
  s.pickDeadline = null;
  const ranked = rankTeams(s.drafters, byId);
  s.winnerId = ranked.length > 0 ? ranked[0].drafterId : null;
}

/** After any state change during a draft, advance bots / check completion. */
function nudgeBots(room: Room): void {
  const s = room.state;
  if (s.phase !== 'draft') return;

  if (freeformNeedsSafetyFill(s)) {
    freeformSafetyFill(s, byId);
    if (room.state.phase === 'complete') finishDraft(room);
    broadcast(room);
    return;
  }

  if (s.mode === 'snake') {
    const cur = currentSnakeDrafter(s);
    if (!cur) return;
    if (cur.isBot) {
      const drafterId = cur.id;
      const pickIdx = s.currentPick;
      scheduleBot(room, botDelay(room.rng), () => {
        const st = room.state;
        // Guard against stale timer (turn moved on).
        if (st.phase !== 'draft' || st.mode !== 'snake') return;
        if (st.pickOrder[st.currentPick] !== drafterId || st.currentPick !== pickIdx) return;
        const d = st.drafters.find((x) => x.id === drafterId)!;
        const choice = botChoose(availablePlayers(st), d, d.personality ?? 'bpa', room.rng);
        if (choice) doSnakePick(st, drafterId, choice.id, byId);
        else autoPickSnake(st, drafterId, byId, room.rng);
        if (room.state.phase === 'complete') finishDraft(room);
        else armDeadline(room);
        broadcast(room);
        nudgeBots(room);
      });
    }
    return;
  }

  // freeform: bots submit hidden picks with staggered delays
  const missing = activeDrafters(s).filter(
    (d) => d.isBot && s.submissions[d.id] === undefined,
  );
  if (missing.length === 0) {
    if (freeformAllSubmitted(s) && activeDrafters(s).length > 0) {
      scheduleBot(room, 2200, () => {
        const st = room.state;
        if (st.phase !== 'draft' || st.mode !== 'freeform') return;
        if (!freeformAllSubmitted(st)) return;
        resolveFreeformRound(st, byId);
        if (room.state.phase === 'complete') finishDraft(room);
        else armDeadline(room);
        broadcast(room);
        nudgeBots(room);
      });
    }
    return;
  }
  const d = missing[0];
  const drafterId = d.id;
  const round = s.round;
  scheduleBot(room, botDelay(room.rng), () => {
    const st = room.state;
    if (st.phase !== 'draft' || st.mode !== 'freeform' || st.round !== round) return;
    if (st.submissions[drafterId] !== undefined) {
      nudgeBots(room);
      return;
    }
    const dd = st.drafters.find((x) => x.id === drafterId)!;
    if (rosterFull(dd)) {
      nudgeBots(room);
      return;
    }
    const choice = botChoose(availablePlayers(st), dd, dd.personality ?? 'bpa', room.rng);
    if (choice) doFreeformSubmit(st, drafterId, choice.id, byId);
    broadcast(room);
    nudgeBots(room);
  });
}

function onDeadline(room: Room): void {
  const s = room.state;
  if (s.phase !== 'draft') return;

  if (s.mode === 'snake') {
    const cur = currentSnakeDrafter(s);
    if (cur) autoPickSnake(s, cur.id, byId, room.rng);
    if (room.state.phase === 'complete') finishDraft(room);
    else armDeadline(room);
    broadcast(room);
    nudgeBots(room);
    return;
  }

  // freeform: auto-submit for everyone still missing (humans get a BPA-ish pick)
  for (const d of activeDrafters(s)) {
    if (s.submissions[d.id] !== undefined) continue;
    const choice = botChoose(availablePlayers(s), d, d.personality ?? 'needs', room.rng);
    if (choice) doFreeformSubmit(s, d.id, choice.id, byId);
  }
  if (freeformAllSubmitted(s)) {
    resolveFreeformRound(s, byId);
  }
  if (room.state.phase === 'complete') finishDraft(room);
  else armDeadline(room);
  broadcast(room);
  nudgeBots(room);
}

// ---------------------------------------------------------------------------
// Lobby ops
// ---------------------------------------------------------------------------

function addDrafter(room: Room, name: string, isBot: boolean, personality?: BotPersonality): Drafter {
  const s = room.state;
  const used = new Set(s.drafters.map((d) => d.name));
  let drafterName = name.trim().slice(0, 24) || (isBot ? 'CPU' : 'Player');
  if (used.has(drafterName)) drafterName = `${drafterName} ${Math.floor(room.rng() * 90 + 10)}`;
  const d: Drafter = {
    id: genId(),
    name: isBot ? randomBotName(room.rng, used) : drafterName,
    isBot,
    personality: isBot ? personality ?? randomPersonality(room.rng) : null,
    roster: [null, null, null, null, null],
    connected: true,
  };
  s.drafters.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(room: Room | undefined, ws: WebSocket, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    sendError(ws, 'Bad message.');
    return;
  }
  const youId = room ? room.clients.get(ws) ?? null : null;

  switch (msg.t) {
    case 'create': {
      const nr = newRoom(msg.mode === 'freeform' ? 'freeform' : 'snake');
      const r: Room = { state: nr, clients: new Map(), deadline: null, botTimer: null, rng: mulberry32(randomSeed()), lastActivity: Date.now() };
      rooms.set(nr.roomId, r);
      const d = addDrafter(r, msg.name, false);
      r.clients.set(ws, d.id);
      broadcast(r);
      break;
    }
    case 'join': {
      const r = rooms.get(msg.roomId.toUpperCase());
      if (!r) {
        sendError(ws, 'Room not found. Check the code.');
        return;
      }
      if (r.state.phase !== 'lobby') {
        sendError(ws, 'Draft already started.');
        return;
      }
      if (r.state.drafters.length >= MAX_DRAFTERS) {
        sendError(ws, 'Room is full (12 max).');
        return;
      }
      const d = addDrafter(r, msg.name, false);
      r.clients.set(ws, d.id);
      r.lastActivity = Date.now();
      broadcast(r);
      break;
    }
    default: {
      if (!room) {
        sendError(ws, 'Join or create a room first.');
        return;
      }
      const s = room.state;
      if (msg.t === 'addBot') {
        if (s.phase !== 'lobby') return sendError(ws, 'Draft already started.');
        if (s.drafters.length >= MAX_DRAFTERS) return sendError(ws, 'Room is full (12 max).');
        addDrafter(room, '', true, msg.personality);
        room.lastActivity = Date.now();
        broadcast(room);
        break;
      }
      if (msg.t === 'removeDrafter') {
        if (s.phase !== 'lobby') return sendError(ws, 'Draft already started.');
        s.drafters = s.drafters.filter((d) => d.id !== msg.drafterId);
        broadcast(room);
        break;
      }
      if (msg.t === 'start') {
        const err = startDraft(room);
        if (err) return sendError(ws, err);
        broadcast(room);
        break;
      }
      if (msg.t === 'pick') {
        if (!youId) return sendError(ws, 'Join the room first.');
        const err = doSnakePick(s, youId, msg.playerId, byId);
        if (err) return sendError(ws, err);
        room.lastActivity = Date.now();
        if (s.phase === 'complete') finishDraft(room);
        else armDeadline(room);
        broadcast(room);
        nudgeBots(room);
        break;
      }
      if (msg.t === 'submit') {
        if (!youId) return sendError(ws, 'Join the room first.');
        const err = doFreeformSubmit(s, youId, msg.playerId, byId);
        if (err) return sendError(ws, err);
        room.lastActivity = Date.now();
        broadcast(room);
        nudgeBots(room);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Server boot
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | undefined;
  // Find the room this socket belongs to once it creates/joins.
  const findRoom = (): Room | undefined => {
    for (const r of rooms.values()) {
      if (r.clients.has(ws)) return r;
    }
    return undefined;
  };

  ws.on('message', (raw) => {
    room = findRoom();
    try {
      handleMessage(room, ws, raw.toString());
    } catch (e) {
      console.error('message error', e);
      sendError(ws, 'Something went wrong. Try again.');
    }
    room = findRoom();
  });

  ws.on('close', () => {
    const r = findRoom();
    if (!r) return;
    const drafterId = r.clients.get(ws);
    r.clients.delete(ws);
    if (drafterId) {
      const d = r.state.drafters.find((x) => x.id === drafterId);
      if (d) d.connected = false;
      broadcast(r);
    }
  });
});

// Sweep idle rooms every 10 minutes (2h idle -> delete).
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (now - r.lastActivity > 2 * 60 * 60 * 1000) {
      clearDeadline(r);
      clearBotTimer(r);
      rooms.delete(id);
    }
  }
}, 10 * 60 * 1000);

console.log(`Draft Arena server listening on :${PORT} (${players.length} players loaded)`);
