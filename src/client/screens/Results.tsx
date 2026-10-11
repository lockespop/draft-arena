import { useMemo, useState } from 'react';
import type { RoomHandle } from '../hooks/useRoom';
import type { ClientRoomView } from '../../shared/types';
import { BY_ID } from '../players';
import { buildJudgePrompt, fetchAIJudge, rankTeams } from '../../engine/judge';
import { Btn, Card, OvrBadge } from '../components/ui';

export function Results({ state }: { rr: RoomHandle; state: ClientRoomView }) {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('draft-arena:openai-key') ?? '',
  );
  const [verdict, setVerdict] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ranked = useMemo(() => rankTeams(state.drafters, BY_ID), [state]);
  const winner = state.drafters.find((d) => d.id === state.winnerId) ?? null;

  const generate = async () => {
    const key = apiKey.trim();
    if (!key) {
      setJudgeError('Paste your OpenAI API key first — it stays in this browser.');
      return;
    }
    localStorage.setItem('draft-arena:openai-key', key);
    setLoading(true);
    setJudgeError(null);
    try {
      const prompt = buildJudgePrompt(state.drafters, BY_ID);
      setVerdict(await fetchAIJudge(key, prompt));
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : 'The judge failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const copySummary = async () => {
    const lines = [
      `🏀 DRAFT ARENA — ${state.mode === 'snake' ? 'Snake Draft' : 'Free-for-All'} results`,
      winner ? `🏆 Winner: ${winner.name}` : '',
      '',
      ...ranked.map(
        (t, i) =>
          `${i + 1}. ${t.name} (score ${Math.round(t.total)}) — ` +
          state.drafters
            .find((d) => d.id === t.drafterId)!
            .roster.map((id) => (id ? BY_ID.get(id)!.name : '?'))
            .join(', '),
      ),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center pt-2">
        <div className="text-5xl mb-1">🏆</div>
        <h2 className="text-2xl font-extrabold">
          {winner ? `${winner.name} wins!` : 'Draft complete!'}
        </h2>
        <p className="text-sm text-slate-400">
          {state.mode === 'snake' ? 'Snake Draft' : 'Free-for-All'} · {state.drafters.length}{' '}
          teams
        </p>
      </div>

      <Card>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          🤖 AI analyst verdict
        </div>
        {verdict ? (
          <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
            {verdict}
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-2">
              Paste an OpenAI API key for a full analyst-style breakdown. The key stays in
              this browser (localStorage) — never sent anywhere except OpenAI.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                className="flex-1 min-h-[48px] px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600 outline-none focus:border-orange-500 text-sm"
              />
              <Btn onClick={generate} disabled={loading} variant="ghost">
                {loading ? '⏳' : 'Judge'}
              </Btn>
            </div>
            {judgeError && <p className="text-xs text-red-400 mt-2">{judgeError}</p>}
            <div className="mt-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Instant ranking (no key needed)
              </div>
              {ranked.map((t, i) => (
                <div key={t.drafterId} className="flex items-center gap-2 py-1 text-sm">
                  <span className="w-6 font-bold text-slate-400">{i + 1}</span>
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-xs text-slate-500">
                    OVR {Math.round(t.avgOvr)}
                  </span>
                  <span className="text-xs font-bold text-orange-300">
                    {Math.round(t.total)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {ranked.map((t) => {
        const d = state.drafters.find((x) => x.id === t.drafterId)!;
        return (
          <Card key={t.drafterId} className="!p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-lg">{d.isBot ? '🤖' : '🧑'}</span>
              <span className="font-bold text-sm flex-1 truncate">{t.name}</span>
              <OvrBadge ovr={Math.round(t.avgOvr)} />
            </div>
            <div className="flex flex-col gap-1 mb-2">
              {d.roster.map((id, i) => {
                const p = id ? BY_ID.get(id) : null;
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-6 text-slate-500 font-bold">
                      {['PG', 'SG', 'SF', 'PF', 'C'][i]}
                    </span>
                    {p ? (
                      <>
                        <span className="flex-1 truncate text-slate-200">
                          {p.name} <span className="text-slate-500">· {p.era}</span>
                        </span>
                        <OvrBadge ovr={p.ovr} />
                      </>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                );
              })}
            </div>
            {t.strengths.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {t.strengths.map((s) => (
                  <span
                    key={s}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            {t.weaknesses.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.weaknesses.map((s) => (
                  <span
                    key={s}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <Btn onClick={copySummary} variant="ghost" className="w-full">
        {copied ? '✅ Copied!' : '📋 Copy results to share'}
      </Btn>
      <Btn
        onClick={() => {
          window.location.href = window.location.pathname;
        }}
        className="w-full"
      >
        New Room
      </Btn>
      <p className="text-[11px] text-slate-600 text-center leading-relaxed">
        Player stats are approximate and era-adjusted for gameplay — not an official record
        book. Full names + stats only; no photos or likenesses.
      </p>
    </div>
  );
}
