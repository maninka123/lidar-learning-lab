export type ViewKind = 'home' | 'top' | 'front' | 'side';
type Listener = (k: ViewKind) => void;
const listeners = new Set<Listener>();
export const viewBus = {
  on(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  emit(k: ViewKind) { listeners.forEach((l) => l(k)); },
};

// Synchronised orbit between several viewports (same group name).
export interface CamState { pos: [number, number, number]; target: [number, number, number]; src: string }
type CamListener = (s: CamState) => void;
const camListeners = new Map<string, Set<CamListener>>();
export const camBus = {
  on(group: string, l: CamListener) {
    if (!camListeners.has(group)) camListeners.set(group, new Set());
    camListeners.get(group)!.add(l);
    return () => { camListeners.get(group)?.delete(l); };
  },
  emit(group: string, s: CamState) { camListeners.get(group)?.forEach((l) => l(s)); },
};
