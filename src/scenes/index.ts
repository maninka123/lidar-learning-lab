import { SceneDef } from './geometry';
import { buildRoom } from './rooms';
import { buildIndustrial } from './industrial';
import { buildOutdoor } from './outdoor';

export type SceneId = 'A' | 'B' | 'C';
const cache: Partial<Record<SceneId, SceneDef>> = {};
export function getScene(id: SceneId): SceneDef {
  if (!cache[id]) cache[id] = id === 'A' ? buildRoom() : id === 'B' ? buildIndustrial() : buildOutdoor();
  return cache[id]!;
}
export const SCENE_IDS: SceneId[] = ['A', 'B', 'C'];
export * from './geometry';
export * from './classes';
