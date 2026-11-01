import { useEffect, useSyncExternalStore } from 'react';

/** "Is the app ready?" as a tiny shared flag. The app calls markAppReady() once its first screen has really appeared. */
let ready = false;
const listeners = new Set<() => void>();
export function markAppReady() { if (!ready) { ready = true; listeners.forEach((f) => f()); } }
export const useAppReady = () => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => ready, () => false);
/** Mounted next to the first screen: it only runs once that screen has loaded, so it is exactly "the app is ready". */
export function ReadySignal() { useEffect(() => { markAppReady(); }, []); return null; }
