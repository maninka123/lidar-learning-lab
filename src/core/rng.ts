/** Deterministic PRNG (mulberry32) so every experiment is reproducible from a seed. */
export interface Rng {
  next(): number;
  gauss(): number;
  range(a: number, b: number): number;
  int(n: number): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9;
  let spare: number | null = null;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss, range: (a, b) => a + (b - a) * next(), int: (n) => Math.floor(next() * n) };
}

/** Hash a string/number tuple to a seed. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const str = String(p);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}
