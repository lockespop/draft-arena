// End-to-end smoke test: real server + real WebSocket client playing full games.
// The "human" client auto-picks instantly so games complete quickly.
// Run:  (1) BOT_DELAY_MIN=150 BOT_DELAY_MAX=400 FREEFORM_SECONDS=8 npm run dev:server
//       (2) npx tsx scripts/smoke.ts
// FREEFORM_SECONDS=8 keeps the deadline-finalize game fast; the other games
// submit instantly so the short deadline never fires for them.

import { WebSocket } from 'ws';
import playersData from '../src/data/players.json';

const URL = 'ws://localhost:3001';

const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const BY_ID = new Map<string, { pos: string; pos2: string | null }>(
  (playersData as any[]).map((p) => [p.id, { pos: p.pos, pos2: p.pos2 }]),
);

interface Msg {
  t: string;
  state?: any;
  youId?: string;
  message?: string;
}

function playGame(
  mode: 'snake' | 'freeform',
  botCount: number,
  opts: { deadlineMode?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    let youId: string | null = null;
    let roomId = '';
    let started = false;
    let lastRound = 0;
    let updateRound = -1;
    // Tentative picks the human synced (deadline mode only); each must end
    // up locked in their roster or eliminated — never silently replaced.
    const tentativeIds: string[] = [];
    const eliminatedIds = new Set<string>();
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`${mode}: timed out waiting for completion`));
    }, 180000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'create', name: 'SmokeTester', mode }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Msg;
      if (msg.t === 'error') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`${mode}: server error: ${msg.message}`));
        return;
      }
      if (msg.t !== 'state' || !msg.state) return;
      const s = msg.state;
      youId = msg.youId ?? youId;
      roomId = s.roomId;

      if (s.phase === 'lobby' && !started) {
        started = true;
        for (let i = 0; i < botCount; i++) ws.send(JSON.stringify({ t: 'addBot' }));
        setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 300);
        return;
      }

      if (s.phase === 'draft') {
        if (mode === 'snake') {
          const cur = s.pickOrder[s.currentPick];
          if (cur === youId && s.pool.length > 0) {
            ws.send(JSON.stringify({ t: 'pick', playerId: s.pool[0] }));
          }
        } else {
          const me = s.drafters.find((d: any) => d.id === youId);
          const needPick = me && me.roster.some((x: any) => x === null);
          if (needPick && !s.submissions[youId!] && s.pool.length > 0) {
            // Human submits a full lineup: one slot-fitting pick per empty slot.
            const picks: { slot: number; playerId: string }[] = [];
            const used = new Set<string>();
            me.roster.forEach((v: any, i: number) => {
              if (v !== null) return;
              const pos = SLOTS[i];
              const pid = (s.pool as string[]).find((id: string) => {
                if (used.has(id)) return false;
                const p = BY_ID.get(id);
                return !!p && (p.pos === pos || p.pos2 === pos);
              });
              if (pid) {
                used.add(pid);
                picks.push({ slot: i, playerId: pid });
              }
            });
            if (opts.deadlineMode) {
              // Sync only a partial tentative lineup, then go AFK: the server
              // deadline must finalize it (never discard the human's picks).
              if (s.round !== updateRound && picks.length > 0) {
                updateRound = s.round;
                const partial = picks.slice(0, 2);
                tentativeIds.push(...partial.map((p) => p.playerId));
                ws.send(JSON.stringify({ t: 'lineup_update', picks: partial }));
              }
            } else {
              // Exercise the tentative-sync path, then submit fully.
              if (s.round !== updateRound && picks.length > 0) {
                updateRound = s.round;
                ws.send(
                  JSON.stringify({ t: 'lineup_update', picks: picks.slice(0, 2) }),
                );
              }
              if (picks.length > 0) ws.send(JSON.stringify({ t: 'submit', picks }));
            }
          }
          if (s.round !== lastRound) {
            lastRound = s.round;
            const elim = s.lastReveal ? s.lastReveal.eliminations.length : 0;
            for (const id of s.lastReveal?.eliminations ?? []) eliminatedIds.add(id);
            console.log(`  [${mode}] round ${s.round}, eliminations so far this reveal: ${elim}`);
          }
        }
        return;
      }

      if (s.phase === 'complete') {
        clearTimeout(timeout);
        const full = s.drafters.every((d: any) => d.roster.every((x: any) => x !== null));
        const seen = new Set<string>();
        let dupes = 0;
        for (const d of s.drafters) {
          for (const id of d.roster) {
            if (seen.has(id)) dupes++;
            seen.add(id);
          }
        }
        console.log(
          `✅ ${mode}: complete — ${s.drafters.length} teams, rosters full: ${full}, dupes: ${dupes}, winnerId: ${s.winnerId ?? 'none'}`,
        );
        if (!full || dupes > 0 || !s.winnerId) {
          reject(new Error(`${mode}: invalid final state`));
        } else if (opts.deadlineMode) {
          // Every tentative pick must have survived: locked in the human's
          // roster, or eliminated by a duplicate — never silently replaced.
          const me = s.drafters.find((d: any) => d.id === youId);
          const mine = new Set<string>(me.roster as string[]);
          const lost = tentativeIds.filter((id) => !mine.has(id) && !eliminatedIds.has(id));
          if (lost.length > 0) {
            reject(new Error(`${mode}: deadline discarded human picks: ${lost.join(',')}`));
          } else {
            console.log(`  [${mode}] deadline preserved ${tentativeIds.length} tentative picks`);
            resolve();
          }
        } else {
          resolve();
        }
        ws.close();
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

async function main(): Promise<void> {
  console.log('--- snake: 1 human + 5 bots ---');
  await playGame('snake', 5);
  console.log('--- freeform: 1 human + 5 bots ---');
  await playGame('freeform', 5);
  console.log('--- snake: solo (1 human + 3 bots) ---');
  await playGame('snake', 3);
  console.log('--- freeform: deadline finalizes tentative picks ---');
  console.log('    (run the server with FREEFORM_SECONDS=8 for this one)');
  await playGame('freeform', 3, { deadlineMode: true });
  console.log('\nAll smoke tests passed.');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
