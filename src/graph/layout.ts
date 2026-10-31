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
  const cx = W / 2, cy = H / 2, R = Math.max(40, Math.min(W, H) / 2 - 62);
  const centreId = order.find((i) => i === 'corridor');
  if (centreId) order.splice(order.indexOf(centreId), 1);
  const n = order.length;
  const rings = n > 16 ? 2 : 1;
  const ring = order.map((id, i) => {
    const ring = rings === 2 ? i % 2 : 0;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = ring ? R * 0.58 : R;
    return { id, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  return centreId ? [...ring, { id: centreId, x: cx, y: cy }] : ring;
}

/**
 * A calm force-directed layout (Fruchterman-Reingold): linked objects pull together, all objects push apart, and nobody leaves the frame.
 * It starts from the circular layout, so the same graph always gives the same picture.
 * `minGap` is the distance in pixels that nodes (and their labels) should keep from each other.
 */
export function forceLayout(ids: string[], edges: { a: string; b: string }[], W: number, H: number, minGap = 64): LayoutNode[] {
  const n = ids.length; if (n === 0) return [];
  const start = circularLayout(ids, edges, W, H), pos = new Map(start.map((p) => [p.id, { x: p.x, y: p.y }]));
  const idx = new Map(ids.map((id, i) => [id, i])), links = edges.map((e) => [idx.get(e.a)!, idx.get(e.b)!] as const).filter(([a, b]) => a !== undefined && b !== undefined && a !== b);
  const X = ids.map((id) => pos.get(id)!.x), Y = ids.map((id) => pos.get(id)!.y);
  const mx = 44, my = 40, w = Math.max(1, W - 2 * mx), h = Math.max(1, H - 2 * my), k = Math.max(minGap, Math.sqrt((w * h) / n) * 0.8);
  for (let it = 0; it < 320; it++) {
    const t = 1 - it / 320, dx = new Float64Array(n), dy = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let ex = X[i] - X[j], ey = Y[i] - Y[j], d = Math.hypot(ex, ey);
      if (d < 0.01) { ex = (i - j) * 0.1; ey = 0.1; d = Math.hypot(ex, ey); }
      const f = (k * k) / d * 0.6 + (d < minGap ? (minGap - d) * 8 : 0); // far push, plus a strong push when two nodes get too close
      dx[i] += (ex / d) * f; dy[i] += (ey / d) * f; dx[j] -= (ex / d) * f; dy[j] -= (ey / d) * f;
    }
    for (const [a, b] of links) {
      const ex = X[a] - X[b], ey = Y[a] - Y[b], d = Math.hypot(ex, ey) || 0.01, f = (d * d) / k * 1.1;
      dx[a] -= (ex / d) * f; dy[a] -= (ey / d) * f; dx[b] += (ex / d) * f; dy[b] += (ey / d) * f;
    }
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < n; i++) { dx[i] += (cx - X[i]) * 1.6; dy[i] += (cy - Y[i]) * 1.6; } // a light pull to the middle keeps loose nodes in view
    const step = Math.max(2, 0.12 * k * t);
    for (let i = 0; i < n; i++) { const d = Math.hypot(dx[i], dy[i]) || 1, m = Math.min(d, step); X[i] += (dx[i] / d) * m; Y[i] += (dy[i] / d) * m; X[i] = Math.min(W - mx, Math.max(mx, X[i])); Y[i] = Math.min(H - my, Math.max(my, Y[i])); }
  }
  return ids.map((id, i) => ({ id, x: X[i], y: Y[i] }));
}
