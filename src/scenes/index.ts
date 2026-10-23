import { SceneDef } from './geometry';
import { buildRoom } from './rooms';
import { buildIndustrial } from './industrial';
import { buildOutdoor } from './outdoor';
import { buildCity } from './city';

export type SceneId = 'A' | 'B' | 'C' | 'D';
const cache: Partial<Record<SceneId, SceneDef>> = {};
export function getScene(id: SceneId): SceneDef {
  if (!cache[id]) cache[id] = id === 'A' ? buildRoom() : id === 'B' ? buildIndustrial() : id === 'C' ? buildOutdoor() : buildCity();
  return cache[id]!;
}
export const SCENE_IDS: SceneId[] = ['A', 'B', 'C']; // scene D is only used by the SLAM & Registration tab
export * from './geometry';
export * from './classes';
