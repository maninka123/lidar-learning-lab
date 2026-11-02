import { create } from 'zustand';

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** State of one guided explanation. ICP and SLAM use the same shape so they behave the same way. */
export interface GuideState {
  on: boolean;
  step: number; // 0-based
  progress: number; // 0..1 inside the step (what moves depends on the step)
  iter: number; // ICP: which solver iteration is being shown
  playing: boolean;
  hold: boolean; // the user is scrubbing: the step animation stays where they put it
  speed: number;
  showLines: boolean; // ICP: correspondences · SLAM: drift
  showGt: boolean;
  showCorrected: boolean;
  start: () => void;
  close: () => void;
  goto: (step: number) => void;
  setProgress: (p: number) => void;
  scrub: (p: number) => void;
  setIter: (i: number, progress?: number) => void;
  play: () => void;
  pause: () => void;
  restart: () => void;
  setSpeed: (s: number) => void;
  set: (patch: Partial<Pick<GuideState, 'showLines' | 'showGt' | 'showCorrected'>>) => void;
}

export function makeGuideStore(steps: number) {
  const last = steps - 1;
  return create<GuideState>((set, get) => ({
    on: false, step: 0, progress: 0, iter: 0, playing: false, hold: false, speed: 1, showLines: true, showGt: true, showCorrected: true,
    start: () => set({ on: true, step: 0, progress: 0, iter: 0, playing: false, hold: false }),
    close: () => set({ on: false, playing: false }),
    goto: (step) => set({ step: Math.max(0, Math.min(last, step)), progress: 0, hold: false, ...(step <= 0 ? { iter: 0 } : {}) }),
    setProgress: (progress) => set({ progress }),
    scrub: (progress) => set({ progress, hold: true, playing: false }),
    setIter: (iter, progress = 0) => set({ iter, progress }),
    play: () => set({ playing: true }),
    pause: () => set({ playing: false }),
    restart: () => set({ step: 0, progress: 0, iter: 0, hold: false, playing: get().playing }),
    setSpeed: (speed) => set({ speed }),
    set: (patch) => set(patch),
  }));
}
export const useIcpGuide = makeGuideStore(5);
export const useSlamGuide = makeGuideStore(6);
export const useOccGuide = makeGuideStore(5);

/** One-shot request to open a lab inside the combined mapping tab (set by the ICP lesson, read when that tab mounts). */
export const nav = { mappingLab: null as null | 'scan' | 'slam' };
