import { INTRO } from './config';

/** The small decisions of the intro as plain functions, so they are easy to read and to test. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

/**
 * Should the intro be shown now? In 'cooldown' mode: yes if it has never been shown, or if it was last shown at least `cooldownMs` ago.
 * The timer runs from the last time the intro was SHOWN: a visit that skips it does not move it. A time in the future (a clock that was changed) counts as "long ago".
 */
export function shouldShowIntro(mode: typeof INTRO.show, storage: KV | null, now: number, cooldownMs: number = INTRO.cooldownMs): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  try {
    const raw = storage?.getItem(INTRO.storageKey), last = raw ? Number(raw) : NaN;
    if (!Number.isFinite(last) || last > now) return true;
    return now - last >= cooldownMs;
  } catch { return true; } // storage unavailable: show it (once per page load), never break the app
}
/** Record that the intro is being shown now. Done as soon as it appears, so a skip, a refresh or a second tab all see it. */
export function rememberIntro(storage: KV | null, now: number) { try { storage?.setItem(INTRO.storageKey, String(now)); } catch { /* ignore */ } }

/** When may the intro start leaving? Skipped, or (the minimum time has passed and the app is ready), or the safety net has run out. */
export function canLeave(s: { elapsedMs: number; minMs: number; ready: boolean; skipped: boolean; maxWaitMs: number }): boolean {
  return s.skipped || (s.elapsedMs >= s.minMs && s.ready) || s.elapsedMs >= s.maxWaitMs;
}
