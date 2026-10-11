import { WebSocket } from 'ws';

// AFK test: human NEVER picks/submits. The server deadline must auto-resolve.
// NOTE: free-form rounds default to a 180s deadline, so run the server with
// FREEFORM_SECONDS=10 for a quick check:
//   FREEFORM_SECONDS=10 npm run dev:server
//   npx tsx scripts/deadline-test.ts [snake|freeform]
const mode = process.argv[2] === 'snake' ? 'snake' : 'freeform';
const ws = new WebSocket('ws://localhost:3001');
let joined = false;
let start = Date.now();

ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: 'AFK', mode })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t !== 'state') return;
  const s = m.state;
  if (s.phase === 'lobby' && !joined) {
    joined = true;
    ws.send(JSON.stringify({ t: 'addBot' }));
    ws.send(JSON.stringify({ t: 'start' }));
    start = Date.now();
  }
  if (s.phase === 'draft' && mode === 'snake' && s.currentPick === 2) {
    console.log(`snake: human turn auto-picked after ${Math.round((Date.now() - start) / 1000)}s (deadline works)`);
    process.exit(0);
  }
  if (s.lastReveal && s.lastReveal.round === 1) {
    console.log(`freeform: round 1 auto-resolved after ${Math.round((Date.now() - start) / 1000)}s (deadline works)`);
    process.exit(0);
  }
});
setTimeout(() => {
  console.log('TIMEOUT — deadline path FAILED');
  process.exit(1);
}, 60000);
