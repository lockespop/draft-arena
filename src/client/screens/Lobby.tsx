import { useState } from 'react';
import type { RoomHandle } from '../hooks/useRoom';
import type { BotPersonality, ClientRoomView } from '../../shared/types';
import { BOT_LABELS, BOT_PERSONALITIES } from '../../shared/types';
import { Btn, Card } from '../components/ui';

export function Lobby({ rr, state }: { rr: RoomHandle; state: ClientRoomView }) {
  const [personality, setPersonality] = useState<'random' | BotPersonality>('random');

  const inviteLink = `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      /* clipboard unavailable */
    }
  };

  const addBot = () =>
    rr.send(
      personality === 'random'
        ? { t: 'addBot' }
        : { t: 'addBot', personality },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Room code</div>
        <div className="text-4xl font-extrabold tracking-[0.25em] text-orange-400">
          {state.roomId}
        </div>
        <button
          onClick={copyLink}
          className="mt-2 text-sm text-slate-300 underline underline-offset-4 active:text-orange-400"
        >
          📋 Copy invite link
        </button>
        <div className="text-xs text-slate-500 mt-1">
          {state.mode === 'snake' ? '🐍 Snake Draft' : '⚡ Free-for-All'} ·{' '}
          {state.drafters.length}/12 players
        </div>
      </div>

      <Card>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Drafters
        </div>
        <div className="flex flex-col gap-1.5">
          {state.drafters.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/70"
            >
              <span className="text-lg">{d.isBot ? '🤖' : '🧑'}</span>
              <span className="flex-1 text-sm font-medium truncate">
                {d.name}
                {d.id === rr.youId && (
                  <span className="ml-2 text-[10px] font-bold text-orange-400 uppercase">
                    You
                  </span>
                )}
              </span>
              {d.isBot && d.personality && (
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                  {BOT_LABELS[d.personality]}
                </span>
              )}
              <button
                onClick={() => rr.send({ t: 'removeDrafter', drafterId: d.id })}
                className="text-slate-500 hover:text-red-400 text-lg leading-none px-1"
                aria-label={`Remove ${d.name}`}
              >
                ×
              </button>
            </div>
          ))}
          {state.drafters.length === 0 && (
            <div className="text-sm text-slate-500 py-2">Nobody here yet.</div>
          )}
        </div>
      </Card>

      <Card>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Add computer opponent
        </div>
        <div className="flex gap-2">
          <select
            value={personality}
            onChange={(e) => setPersonality(e.target.value as 'random' | BotPersonality)}
            className="flex-1 min-h-[48px] px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 outline-none"
          >
            <option value="random">🎲 Random style</option>
            {BOT_PERSONALITIES.map((p) => (
              <option key={p} value={p}>
                {BOT_LABELS[p]}
              </option>
            ))}
          </select>
          <Btn onClick={addBot} variant="ghost" disabled={state.drafters.length >= 12}>
            + Add
          </Btn>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Solo vs bots works — add opponents and start whenever.
        </p>
      </Card>

      <Btn
        onClick={() => rr.send({ t: 'start' })}
        disabled={state.drafters.length < 1}
        className="w-full text-lg"
      >
        Start Draft 🚀
      </Btn>
    </div>
  );
}
