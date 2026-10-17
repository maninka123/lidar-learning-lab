export interface LayoutNode { id: string; x: number; y: number }

/**
 * Deterministic circular layout. Nodes are ordered greedily so that connected nodes sit next to each
 * other; large graphs use two concentric rings. Readable and stable, which matters more here than
 * a "physically" relaxed force layout.
 */
export function circularLayout(ids: string[], edges: { a: string; b: string }[], W: number, H: number): LayoutNode[] {
  const adj = new Map<string, Set<string>>(ids.map((i) => [i, new Set<string>()]));
  for (const e of edges) { adj.get(e.a)?.add(e.b); adj.get(e.b)?.add(e.a); }
  const left = new Set(ids);
  const order: string[] = [];
  while (left.size) {
    // start a new component at the node with the most connections
    let start = [...left].sort((a, b) => adj.get(b)!.size - adj.get(a)!.size || a.localeCompare(b))[0];
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (!left.has(cur)) continue;
      left.delete(cur); order.push(cur);
      const nb = [...adj.get(cur)!].filter((x) => left.has(x)).sort((a, b) => adj.get(a)!.size - adj.get(b)!.size || b.localeCompare(a));
      stack.push(...nb);
    }
    void start;
  }
  const cx = W / 2, cy = H / 2, R = Math.max(40, Math.min(W, H) / 2 - 70);
  const n = order.length;
  const rings = n > 16 ? 2 : 1;
  return order.map((id, i) => {
    const ring = rings === 2 ? i % 2 : 0;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = ring ? R * 0.58 : R;
    return { id, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}
