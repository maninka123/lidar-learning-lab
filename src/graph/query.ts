import { SceneGraph, GraphNode, aabbGap, centreDistance, scannerGap, REL_LABEL } from './sceneGraph';
import { className } from '../scenes/classes';
import { dist } from '../core/math';

export interface QueryAnswer {
  intent: string;
  answer: string;
  nodeIds: string[];
  evidence: { label: string; value: string }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Resolve a phrase such as "table 1" or "the chair" to graph nodes. */
export function findNodes(graph: SceneGraph, phrase: string): GraphNode[] {
  const p = norm(phrase).replace(/^(the|a|an) /, '');
  if (!p) return [];
  const objs = graph.nodes;
  const exact = objs.filter((n) => norm(n.id) === p || norm(n.label) === p);
  if (exact.length) return exact;
  const toks = p.split(' ');
  return objs.filter((n) => {
    const hay = norm(`${n.id} ${n.label} ${className(n.classId)}`);
    return toks.every((t) => hay.includes(t.replace(/s$/, '')));
  });
}

const fmt = (v: number) => `${v.toFixed(2)} m`;

export const SUPPORTED_QUESTIONS = [
  'What objects are in the room?',
  'Which object is closest to the scanner?',
  'What is next to the table?',
  'Which objects intersect the walking corridor?',
  'What is the distance between table 1 and chair 2?',
  'What is on top of table 1?',
  'How many chairs are there?',
];

/** Deterministic intent matcher. NOT a language model: it only understands the patterns below. */
export function answerQuery(graph: SceneGraph, q: string): QueryAnswer {
  const text = norm(q);
  const objs = graph.nodes.filter((n) => !n.structural);
  const none = (intent: string): QueryAnswer => ({ intent, answer: 'I could not find a matching object.', nodeIds: [], evidence: [] });

  let m = text.match(/distance (?:between|from) (.+?) (?:and|to) (.+)$/);
  if (m) {
    const A = findNodes({ ...graph, nodes: objs }, m[1]), B = findNodes({ ...graph, nodes: objs }, m[2]);
    if (!A.length || !B.length) return none('distance');
    let best: [GraphNode, GraphNode] = [A[0], B[0]], bd = Infinity;
    for (const a of A) for (const b of B) if (a !== b && centreDistance(a, b) < bd) { bd = centreDistance(a, b); best = [a, b]; }
    const gap = aabbGap(best[0], best[1]);
    return {
      intent: 'distance between two objects',
      answer: `${best[0].label} ↔ ${best[1].label}: centre-to-centre ${fmt(bd)}; nearest surfaces (bounding boxes) ${fmt(gap)} apart.`,
      nodeIds: [best[0].id, best[1].id],
      evidence: [{ label: 'centre distance', value: fmt(bd) }, { label: 'bbox gap', value: fmt(gap) }, { label: 'A position', value: best[0].position.map((v) => v.toFixed(2)).join(', ') }, { label: 'B position', value: best[1].position.map((v) => v.toFixed(2)).join(', ') }],
    };
  }
  if (/(closest|nearest).*(scanner|sensor|me)|(scanner|sensor).*(closest|nearest)/.test(text)) {
    const ranked = objs.map((n) => ({ n, d: scannerGap(graph.scanner.pos, n), c: dist(graph.scanner.pos, n.position) })).sort((a, b) => a.d - b.d);
    const top = ranked.slice(0, 3);
    return {
      intent: 'closest object to scanner',
      answer: `${top[0].n.label} is closest: ${fmt(top[0].d)} from the scanner to its bounding box (centre ${fmt(top[0].c)}).`,
      nodeIds: [top[0].n.id],
      evidence: top.map((t, i) => ({ label: `#${i + 1} ${t.n.label}`, value: fmt(t.d) })),
    };
  }
  if (/corridor|walking|walkway|path|block|obstruct/.test(text)) {
    const blockers = graph.edges.filter((e) => e.type === 'blocks_path').map((e) => graph.nodes.find((n) => n.id === e.from)!);
    return blockers.length
      ? { intent: 'objects blocking the corridor', answer: `${blockers.length} object(s) intersect the walking corridor: ${blockers.map((b) => b.label).join(', ')}.`, nodeIds: blockers.map((b) => b.id), evidence: blockers.map((b) => ({ label: b.label, value: `centre ${b.position.map((v) => v.toFixed(2)).join(', ')}` })) }
      : { intent: 'objects blocking the corridor', answer: 'The corridor is clear: no object bounding box intersects it.', nodeIds: [], evidence: [] };
  }
  m = text.match(/(?:what is|what s|what are|whats) (?:on top of|on|above|over) (.+)$/);
  if (m) {
    const T = findNodes({ ...graph, nodes: objs }, m[1])[0];
    if (!T) return none('above');
    const above = graph.edges.filter((e) => e.type === 'above' && e.to === T.id).map((e) => ({ n: graph.nodes.find((n) => n.id === e.from)!, v: e.value ?? 0 }));
    return { intent: `objects above ${T.label}`, answer: above.length ? `Above ${T.label}: ${above.map((a) => `${a.n.label} (${fmt(a.v)} clearance)`).join(', ')}.` : `Nothing is above ${T.label}.`, nodeIds: [T.id, ...above.map((a) => a.n.id)], evidence: above.map((a) => ({ label: a.n.label, value: fmt(a.v) })) };
  }
  m = text.match(/(?:next to|beside|near|adjacent to|close to|around) (.+)$/);
  if (m) {
    const targets = findNodes({ ...graph, nodes: objs }, m[1]);
    if (!targets.length) return none('near');
    const ids = new Set<string>();
    const ev: { label: string; value: string }[] = [];
    for (const t of targets) for (const e of graph.edges) if (e.type === 'near' && (e.from === t.id || e.to === t.id)) {
      const other = e.from === t.id ? e.to : e.from;
      if (targets.some((x) => x.id === other)) continue;
      ids.add(other); ev.push({ label: `${t.label} → ${graph.nodes.find((n) => n.id === other)?.label}`, value: `${fmt(e.value ?? 0)} gap` });
    }
    const names = [...ids].map((id) => graph.nodes.find((n) => n.id === id)!.label);
    return { intent: `near ${targets.map((t) => t.label).join(' / ')}`, answer: names.length ? `Within ${fmt(graph.nearThreshold)} of ${targets.map((t) => t.label).join(' / ')}: ${names.join(', ')}.` : `Nothing is within ${fmt(graph.nearThreshold)} of ${targets.map((t) => t.label).join(' / ')}.`, nodeIds: [...targets.map((t) => t.id), ...ids], evidence: ev };
  }
  m = text.match(/how many (\w+)/);
  if (m) {
    const w = m[1].replace(/s$/, '');
    const hit = objs.filter((n) => norm(`${className(n.classId)} ${n.label}`).includes(w));
    return { intent: 'count', answer: `${hit.length} object(s) match "${m[1]}"${hit.length ? `: ${hit.map((h) => h.label).join(', ')}` : ''}.`, nodeIds: hit.map((h) => h.id), evidence: [{ label: 'count', value: String(hit.length) }] };
  }
  if (/(what|which|list|show|objects|things|inventory)/.test(text) && /(room|scene|here|objects|things|inventory|there)/.test(text)) {
    return { intent: 'list objects', answer: `${objs.length} objects: ${objs.map((o) => o.label).join(', ')}.`, nodeIds: objs.map((o) => o.id), evidence: objs.slice(0, 12).map((o) => ({ label: o.label, value: o.dimensions.map((v) => v.toFixed(2)).join(' × ') + ' m' })) };
  }
  return { intent: 'unrecognised', answer: 'This offline demo only understands a fixed set of question patterns (it is not an LLM). Try one of the suggested questions.', nodeIds: [], evidence: [] };
}

export const relationText = (type: keyof typeof REL_LABEL) => REL_LABEL[type];

/** The tool contract a real LLM would be given (documentation only; no LLM is called by this app). */
export const LLM_TOOL_SCHEMA = [
  { name: 'list_objects', description: 'Return all scene-graph nodes with id, label, position, dimensions, bbox, source and confidence.', input: {} },
  { name: 'distance', description: 'Exact distances between two node ids, computed from world-coordinate bounding boxes.', input: { a: 'string', b: 'string' } },
  { name: 'relations', description: 'Return relations (near/above/below/inside/left_of/right_of/intersects/blocks_path) for a node id.', input: { id: 'string' } },
  { name: 'closest_to_scanner', description: 'Rank nodes by surface distance from the scanner pose.', input: { k: 'number' } },
];
