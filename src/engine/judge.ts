// AI judge: ranks finished lineups. Two layers:
//  1. Deterministic heuristic score (always available, shown instantly).
//  2. LLM analyst verdict via the user's own OpenAI API key (optional).

import type { Drafter, Player } from '../shared/types';
import { SLOTS } from '../shared/types';

export interface TeamScore {
  drafterId: string;
  name: string;
  total: number;
  avgOvr: number;
  offense: number;
  defense: number;
  fit: number;
  starPower: number;
  strengths: string[];
  weaknesses: string[];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function scoreTeam(d: Drafter, byId: Map<string, Player>): TeamScore {
  const roster = d.roster.map((id) => (id ? byId.get(id)! : null)).filter((p) => p !== null);

  const avgOvr = mean(roster.map((p) => p.ovr));
  const offense = mean(roster.map((p) => (p.attr.sco + p.attr.sho + p.attr.ply) / 3));
  const defense = mean(roster.map((p) => (p.attr.def + p.attr.reb) / 2));
  const balance = Math.max(0, 100 - Math.abs(offense - defense) * 1.5);

  // Fit: primary-position matches score highest.
  let fit = 100;
  d.roster.forEach((id, i) => {
    if (!id) return;
    const p = byId.get(id)!;
    if (p.pos !== SLOTS[i]) fit -= p.pos2 === SLOTS[i] ? 4 : 10;
  });
  fit = Math.max(0, fit);

  const sorted = [...roster].sort((a, b) => b.ovr - a.ovr);
  const starPower = mean(sorted.slice(0, 2).map((p) => p.ovr));
  const consistency = Math.max(0, 100 - stdev(roster.map((p) => p.ovr)) * 4);

  const total =
    avgOvr * 0.45 + balance * 0.15 + fit * 0.15 + starPower * 0.15 + consistency * 0.1;

  // Narrative strengths / weaknesses from attribute extremes.
  const attrMean = {
    Scoring: mean(roster.map((p) => p.attr.sco)),
    Defense: mean(roster.map((p) => p.attr.def)),
    Playmaking: mean(roster.map((p) => p.attr.ply)),
    Rebounding: mean(roster.map((p) => p.attr.reb)),
    Athleticism: mean(roster.map((p) => p.attr.ath)),
    Shooting: mean(roster.map((p) => p.attr.sho)),
  };
  const entries = Object.entries(attrMean).sort((a, b) => b[1] - a[1]);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const [label, v] of entries.slice(0, 2)) {
    if (v >= 86) strengths.push(`Elite ${label.toLowerCase()} (${Math.round(v)})`);
    else if (v >= 80) strengths.push(`Strong ${label.toLowerCase()} (${Math.round(v)})`);
  }
  for (const [label, v] of entries.slice(-2).reverse()) {
    if (v <= 76) weaknesses.push(`Shaky ${label.toLowerCase()} (${Math.round(v)})`);
  }
  if (fit < 85) weaknesses.push('Awkward positional fits');
  if (starPower >= 95) strengths.push('Multiple MVP-caliber cornerstones');

  return {
    drafterId: d.id, name: d.name, total, avgOvr, offense, defense, fit, starPower,
    strengths, weaknesses,
  };
}

export function rankTeams(drafters: Drafter[], byId: Map<string, Player>): TeamScore[] {
  return drafters.map((d) => scoreTeam(d, byId)).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// LLM analyst verdict
// ---------------------------------------------------------------------------

export function buildJudgePrompt(drafters: Drafter[], byId: Map<string, Player>): string {
  const lines: string[] = [];
  lines.push('You are a sharp, entertaining NBA analyst judging a fantasy all-time draft.');
  lines.push('Each drafter built a starting five (PG/SG/SF/PF/C). OVR is an era-adjusted 0-99 overall rating;');
  lines.push('attributes (SCO/DEF/PLY/REB/ATH/SHO) are also era-adjusted 0-99.');
  lines.push('');
  lines.push('Rubric: roster fit and chemistry, two-way balance, era-adjusted production,');
  lines.push('positional coverage, and star power vs depth. Pick ONE winner — no ties.');
  lines.push('');
  for (const d of drafters) {
    lines.push(`## ${d.name}`);
    d.roster.forEach((id, i) => {
      const p = id ? byId.get(id) : null;
      if (!p) {
        lines.push(`- ${SLOTS[i]}: (empty)`);
        return;
      }
      lines.push(
        `- ${SLOTS[i]}: ${p.name} (${p.pos}${p.pos2 ? '/' + p.pos2 : ''}, ${p.era}) ` +
        `OVR ${p.ovr} — ${p.ppg}/${p.rpg}/${p.apg} | ` +
        `SCO ${p.attr.sco} DEF ${p.attr.def} PLY ${p.attr.ply} REB ${p.attr.reb} ATH ${p.attr.ath} SHO ${p.attr.sho} | ${p.acc.join(', ')}`,
      );
    });
    lines.push('');
  }
  lines.push('Format your verdict in markdown:');
  lines.push('1. A ranked list (1st to last) with one-line justification each.');
  lines.push('2. A WINNER section naming the champion and 3-4 sentences on why they win — be opinionated and specific.');
  lines.push('3. For every other team, 2-3 sentences: biggest strength, fatal flaw.');
  lines.push('Keep the whole thing under 450 words. Talk like a TV analyst, not a spreadsheet.');
  return lines.join('\n');
}

export async function fetchAIJudge(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a sharp, entertaining NBA analyst. You judge fantasy drafts decisively and colorfully.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.8,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI.');
  return text;
}
