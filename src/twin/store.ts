import { emptyProgress, invalidateProgress, MISSIONS, readyForFinal, type MissionProgress } from './missions';
import { create } from 'zustand';
import { TwinDesign, EMPTY_DESIGN, ChallengeSettings, DEFAULT_SETTINGS, LIDARS, CAMERAS, RES_TIERS, inspectionCamera, budgetFor, ALL_LIDARS } from './catalogue';
import { Block, BLOCKS } from './pipeline';
import type { RunResult, FinalResult } from './runner';

/** The team's workspace: everything they have chosen, saved in the browser. Heavy results (clouds) are not saved, only the numbers. */
export interface AttemptSummary { mission?: number; status?: string; at: number; kind: 'practice' | 'final'; seed: number | number[]; total: number; tasks: Record<string, number>; cost: number }
export interface SavedPipeline { name: string; blocks: Block[] }
export interface TwinSave {
  version: 2; progress: MissionProgress; team: string; members: string[]; settings: ChallengeSettings; design: TwinDesign; pipeline: Block[]; saved: SavedPipeline[];
  student: { name: string; index: string }; startedAt: number; sent: { at: number; kind: 'practice' | 'final'; total: number }[];
  attempts: AttemptSummary[]; finalSubmitted: { at: number; design: TwinDesign; pipeline: Block[]; total: number } | null; stage: number;
}
const KEY = 'lidar-lab-twin';

export const initialSave = (): TwinSave => ({ version: 2, progress: emptyProgress(), team: '', members: [], settings: DEFAULT_SETTINGS, design: { ...EMPTY_DESIGN, cameras: [inspectionCamera()] }, pipeline: [], saved: [], attempts: [], finalSubmitted: null, stage: 1, student: { name: '', index: '' }, startedAt: Date.now(), sent: [] });

/** Every LiDAR measures at its standard resolution: the choice of coarse or fine was removed, so an older save is brought back to standard. */
export const standardRes = <D extends { lidars: { res: string }[] }>(d: D): D => (d.lidars.every((u) => u.res === 'standard') ? d : { ...d, lidars: d.lidars.map((u) => ({ ...u, res: 'standard' })) });
export function migrateSave(value: unknown): TwinSave | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Partial<TwinSave> & { version?: number };
  if (![1, 2].includes(Number(o.version)) || !o.design || !Array.isArray(o.design.lidars) || !Array.isArray(o.design.cameras) || !Array.isArray(o.design.lights) || !Array.isArray(o.pipeline)) return null;
  if (o.pipeline.some((b) => !b || !BLOCKS[b.kind] || !b.params || Object.values(b.params).some((v) => !Number.isFinite(v)))) return null;
  if (o.design.lidars.some((u) => !LIDARS.some((l) => l.id === u.item) || !RES_TIERS[u.res] || ![u.x,u.y,u.z,u.yaw,u.pitch].every(Number.isFinite))) return null;
  if (o.design.cameras.some((c) => !CAMERAS.some((it) => it.id === c.item) || !c.cal?.est || ![c.x,c.y,c.z,c.yaw,c.pitch,c.cal.fov,...Object.values(c.cal.est)].every(Number.isFinite))) return null;
  const base = initialSave();
  const raw = o.progress, unlocked = Math.max(0, Math.min(6, Math.floor(Number.isFinite(raw?.unlocked) ? raw!.unlocked : 0)));
  const progress: MissionProgress = raw ? { current: Math.max(0, Math.min(unlocked, Math.floor(Number.isFinite(raw.current) ? raw.current : 0))), unlocked, results: Array.from({ length: 7 }, (_, i) => Array.isArray(raw.results) && raw.results[i] && typeof raw.results[i]?.fingerprint === 'string' && Array.isArray(raw.results[i]?.metrics) && Array.isArray(raw.results[i]?.feedback) ? raw.results[i] : null), attempts: Array.from({ length: 7 }, (_, i) => Number.isFinite(raw.attempts?.[i]) ? Math.max(0, raw.attempts[i]) : 0) } : emptyProgress();
  const settings = { ...DEFAULT_SETTINGS, ...o.settings, budgetVersion: 4 as const, budget: budgetFor(o.settings ?? {}), weights: { ...DEFAULT_SETTINGS.weights, ...o.settings?.weights }, enabled: { ...DEFAULT_SETTINGS.enabled, ...o.settings?.enabled } };
  // Legacy equipment, pipelines and attempts survive. Old stage visits do not count as measured mission passes.
  const design = standardRes({ ...EMPTY_DESIGN, ...o.design });
  design.cameras = design.cameras.map((c) => (c.pairedLidarId === null ? { ...c, pairedLidarId: ALL_LIDARS } : c)); // the clouds are registered into one: a camera that was waiting to be paired uses the combined cloud
  const merged = { ...base, ...o, version: 2 as const, settings, progress, design };
  merged.progress = invalidateProgress(progress, { design: merged.design, pipeline: merged.pipeline, settings });
  merged.stage = (MISSIONS[progress.current].tools as readonly number[]).includes(o.stage ?? -1) ? o.stage! : MISSIONS[progress.current].tools[0];
  return merged;
}
function load(): TwinSave {
  try { const v = localStorage.getItem(KEY); if (v) return migrateSave(JSON.parse(v)) ?? initialSave(); } catch { /* storage unavailable */ }
  return initialSave();
}
export const parseSave = (text: string): TwinSave | null => { try { return migrateSave(JSON.parse(text)); } catch { return null; } };

interface Live { practice: RunResult | null; final: FinalResult | null; busy: string | null; selectedStep: number; selectedUnit: string | null }
interface TwinState extends TwinSave, Live {
  set: (p: Partial<TwinSave & Live>) => void;
  reset: () => void;
  importSave: (s: TwinSave) => void;
}
export const useTwin = create<TwinState>((set) => ({
  ...load(), practice: null, final: null, busy: null, selectedStep: -1, selectedUnit: null,
  set: (p) => set((cur) => {
    const next = { ...cur, ...p };
    if (p.progress && p.progress.current > cur.progress.unlocked) next.progress = { ...p.progress, current: cur.progress.current };
    if (p.design) next.design = standardRes(p.design);
    if (p.design || p.pipeline || p.settings) {
      next.progress = invalidateProgress(next.progress, { design: next.design, pipeline: next.pipeline, settings: next.settings });
      next.practice = null; next.final = null; next.selectedStep = -1;
    }
    const tools = MISSIONS[next.progress.current].tools;
    if (!(tools as readonly number[]).includes(next.stage)) next.stage = tools[0];
    if (p.final && !readyForFinal(next.progress)) next.final = null;
    return next;
  }), reset: () => set({ ...initialSave(), practice: null, final: null, busy: null, selectedUnit: null, selectedStep: -1 }), importSave: (s) => set({ ...s, practice: null, final: null, busy: null, selectedUnit: null, selectedStep: -1 }),
}));
export const snapshot = (s: TwinState): TwinSave => ({ version: 2, progress: s.progress, team: s.team, members: s.members, settings: s.settings, design: s.design, pipeline: s.pipeline, saved: s.saved, attempts: s.attempts, finalSubmitted: s.finalSubmitted, stage: s.stage, student: s.student, startedAt: s.startedAt, sent: s.sent });
let timer: ReturnType<typeof setTimeout> | null = null;
useTwin.subscribe((s) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(snapshot(s))); } catch { /* storage unavailable */ } }, 300); });
