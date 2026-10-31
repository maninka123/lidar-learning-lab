import { DT, TemporalGraph, trackName } from './moving';

/** Questions about the drive that are answered straight from the temporal scene graph: no AI, every number comes from the tracks and events. */
export const OFFLINE_QUESTIONS = [
  'What is moving, and how fast?',
  'What is standing still?',
  'How many people, cars and poles are there?',
  'Is anything approaching the vehicle?',
  'Who crosses the vehicle’s path, and when?',
  'What happens, in order?',
];
export interface OfflineAnswer { intent: string; text: string }

const table = (head: string[], rows: string[][]) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
const time = (f: number) => `frame ${f + 1} (${(f * DT).toFixed(1)} s)`;
const real = (g: TemporalGraph) => g.tracks.filter((t) => t.cls !== 'building / structure' && t.obs.length >= 3);

export function answerOffline(question: string, g: TemporalGraph): OfflineAnswer {
  const q = question.toLowerCase(), tr = real(g);
  const has = (re: RegExp) => re.test(q);
  if (has(/approach|closer|getting near|danger|collid|toward/)) {
    const ev = g.events.filter((e) => /approaching|comes within/.test(e.text));
    return { intent: 'approaching', text: ev.length ? table(['When', 'What'], ev.map((e) => [time(e.frame), e.text])) : 'Nothing gets noticeably closer to the vehicle.' };
  }
  if (has(/cross|path|in front|pedestrian/)) {
    const ev = g.events.filter((e) => /crosses|passes/.test(e.text));
    return { intent: 'crossing', text: ev.length ? table(['When', 'What'], ev.map((e) => [time(e.frame), e.text])) : 'Nobody crosses the vehicle’s path in these frames.' };
  }
  if (has(/still|static|stationary|parked|not moving|stand/)) {
    const st = tr.filter((t) => !t.moving);
    if (!st.length) return { intent: 'still', text: 'Everything that was tracked is moving.' };
    return { intent: 'still', text: table(['Object', 'Seen in'], st.map((t) => [trackName(t), `${t.obs.length} of ${g.ego.length} frames`])) };
  }
  if (has(/how many|count|number of|people|cars|poles|trees/) && !has(/fast|speed/)) {
    const by = new Map<string, { n: number; mv: number }>();
    tr.forEach((t) => { const c = by.get(t.cls) ?? { n: 0, mv: 0 }; c.n++; if (t.moving) c.mv++; by.set(t.cls, c); });
    return { intent: 'count', text: table(['Kind', 'Tracked', 'Moving'], [...by.entries()].map(([k, v]) => [k, String(v.n), String(v.mv)])) };
  }
  if (has(/what happen|in order|events|timeline|summar|story|happened/)) {
    return { intent: 'events', text: g.events.length ? table(['When', 'What'], g.events.map((e) => [time(e.frame), e.text])) : 'Nothing notable happens.' };
  }
  if (has(/fast|speed|moving|move|velocity|m\/s/)) {
    const mv = tr.filter((t) => t.moving).sort((a, b) => b.speed - a.speed);
    return { intent: 'moving', text: mv.length ? table(['Object', 'Speed', 'Seen in'], mv.map((t) => [trackName(t), `${t.speed.toFixed(1)} m/s (${(t.speed * 3.6).toFixed(0)} km/h)`, `${t.obs.length} frames`])) : 'Nothing is moving.' };
  }
  return { intent: 'unknown', text: `I can answer these without an AI:\n\n${OFFLINE_QUESTIONS.map((x) => `- ${x}`).join('\n')}\n\nFor anything else, use the chat above.` };
}
