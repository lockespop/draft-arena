import { useEffect, useState } from 'react';
import type { RoomHandle } from '../hooks/useRoom';
import type { DraftMode } from '../../shared/types';
import { Btn } from '../components/ui';

export function Home({ rr }: { rr: RoomHandle }) {
  const [name, setName] = useState(
    () => localStorage.getItem('draft-arena:name') ?? '',
  );
  const [mode, setMode] = useState<DraftMode>('snake');
  const [code, setCode] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('room');
    if (q) setCode(q.toUpperCase());
  }, []);

  const saveName = () => {
    const n = name.trim() || 'Player';
    localStorage.setItem('draft-arena:name', n);
    return n;
  };

  const create = () => rr.send({ t: 'create', name: saveName(), mode });
  const join = () => {
    if (!code.trim()) return;
    rr.send({ t: 'join', roomId: code.trim().toUpperCase(), name: saveName() });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="text-center pt-6">
        <div className="text-5xl mb-2">🏀</div>
        <h1 className="text-3xl font-extrabold tracking-tight">Draft Arena</h1>
        <p className="text-slate-400 text-sm mt-1">
          All-time NBA draft battles. Out-draft your friends. Let the AI judge.
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Your display name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mike"
          maxLength={24}
          className="mt-1 w-full min-h-[52px] px-4 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder:text-slate-600 outline-none focus:border-orange-500 text-lg"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Game mode
        </label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            onClick={() => setMode('snake')}
            className={`p-3 rounded-xl border text-left transition ${
              mode === 'snake'
                ? 'bg-orange-500/15 border-orange-500'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="font-bold text-sm">🐍 Snake Draft</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Classic turn-based drafting, 5 rounds
            </div>
          </button>
          <button
            onClick={() => setMode('freeform')}
            className={`p-3 rounded-xl border text-left transition ${
              mode === 'freeform'
                ? 'bg-orange-500/15 border-orange-500'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="font-bold text-sm">⚡ Free-for-All</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Simultaneous picks — contested players are eliminated
            </div>
          </button>
        </div>
      </div>

      <Btn onClick={create} disabled={!rr.connected} className="w-full text-lg">
        Create Room
      </Btn>

      <div className="flex items-center gap-3 text-slate-600 text-xs">
        <div className="flex-1 h-px bg-slate-800" />
        or join a friend
        <div className="flex-1 h-px bg-slate-800" />
      </div>

      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          placeholder="Room code"
          maxLength={6}
          className="flex-1 min-h-[52px] px-4 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder:text-slate-600 outline-none focus:border-orange-500 uppercase tracking-[0.3em] text-center text-lg font-bold"
        />
        <Btn onClick={join} disabled={!rr.connected || !code.trim()} variant="ghost">
          Join
        </Btn>
      </div>

      {!rr.connected && (
        <p className="text-center text-xs text-amber-400">
          Connecting to the game server…
        </p>
      )}
    </div>
  );
}
