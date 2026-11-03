import { create } from 'zustand';
import { TwinDesign, EMPTY_DESIGN, ChallengeSettings, DEFAULT_SETTINGS } from './catalogue';
import { Block, newBlock } from './pipeline';
import type { RunResult, FinalResult } from './runner';

/** The team's workspace: everything they have chosen, saved in the browser. Heavy results (clouds) are not saved, only the numbers. */
export interface AttemptSummary { at: number; kind: 'practice' | 'final'; seed: number | number[]; total: number; tasks: Record<string, number>; cost: number }
export interface SavedPipeline { name: string; blocks: Block[] }
export interface TwinSave {
  version: 1; team: string; members: string[]; settings: ChallengeSettings; design: TwinDesign; pipeline: Block[]; saved: SavedPipeline[];
  student: { name: string; index: string }; startedAt: number; sent: { at: number; kind: 'practice' | 'final'; total: number }[];
  attempts: AttemptSummary[]; finalSubmitted: { at: number; design: TwinDesign; pipeline: Block[]; total: number } | null; stage: number;
}
export const STAGES = ['Mission', 'Equipment', 'Deploy', 'Calibrate', 'Acquire', 'Pipeline', 'Digital twin', 'Tasks', 'Evaluate'] as const;
const KEY = 'lidar-lab-twin';

export const initialSave = (): TwinSave => ({ version: 1, team: '', members: [], settings: DEFAULT_SETTINGS, design: EMPTY_DESIGN, pipeline: [], saved: [], attempts: [], finalSubmitted: null, stage: 0, student: { name: '', index: '' }, startedAt: Date.now(), sent: [] });

function load(): TwinSave {
  try { const v = localStorage.getItem(KEY); if (v) { const o = JSON.parse(v) as TwinSave; if (o.version === 1) return { ...initialSave(), ...o, settings: { ...DEFAULT_SETTINGS, ...o.settings, weights: { ...DEFAULT_SETTINGS.weights, ...o.settings?.weights }, enabled: { ...DEFAULT_SETTINGS.enabled, ...o.settings?.enabled } } }; } } catch { /* private window: start empty */ }
  return initialSave();
}
export const parseSave = (text: string): TwinSave | null => { try { const o = JSON.parse(text) as TwinSave; return o && o.version === 1 && Array.isArray(o.pipeline) && o.design ? { ...initialSave(), ...o } : null; } catch { return null; } };

interface Live { practice: RunResult | null; final: FinalResult | null; busy: string | null; selectedStep: number; selectedUnit: string | null }
interface TwinState extends TwinSave, Live {
  set: (p: Partial<TwinSave & Live>) => void;
  reset: () => void;
  importSave: (s: TwinSave) => void;
}
export const useTwin = create<TwinState>((set) => ({
  ...load(), practice: null, final: null, busy: null, selectedStep: -1, selectedUnit: null,
  set: (p) => set(p), reset: () => set({ ...initialSave(), practice: null, final: null }), importSave: (s) => set({ ...s, practice: null, final: null }),
}));
export const snapshot = (s: TwinState): TwinSave => ({ version: 1, team: s.team, members: s.members, settings: s.settings, design: s.design, pipeline: s.pipeline, saved: s.saved, attempts: s.attempts, finalSubmitted: s.finalSubmitted, stage: s.stage, student: s.student, startedAt: s.startedAt, sent: s.sent });
let timer: ReturnType<typeof setTimeout> | null = null;
useTwin.subscribe((s) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(snapshot(s))); } catch { /* storage unavailable */ } }, 300); });
