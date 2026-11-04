import { getPreset, presetToConfig, SensorConfig } from '../sensor/presets';
import type { Extrinsic } from '../apps/fusion';
import { usd } from './pricing';

/** The equipment shop of the challenge. Credits are USD reference prices divided by 5; see pricing.ts for published prices versus educational estimates.
 *  Better hardware costs more, and it earns its keep only through what it actually measures. */

export type ResTier = 'coarse' | 'standard' | 'fine';
export const RES_TIERS: Record<ResTier, { label: string; hRes: number; cost: number }> = {
  coarse: { label: 'Coarse (2× wider angle steps)', hRes: 2, cost: 0.75 },
  standard: { label: 'Standard', hRes: 1, cost: 1 },
  fine: { label: 'Fine (½ the angle step)', hRes: 0.5, cost: 1.6 },
};

export interface LidarItem {
  id: string; name: string; preset: string; kind: 'low' | 'medium' | 'high' | 'multi' | 'solid' | 'tls' | 'mobile';
  cost: number;
  /** extra range noise (m, 1σ), share of returns lost, share of returns replaced by floating outliers */
  noise: number; dropout: number; outliers: number;
  /** most rays one scan may use: how long the scanner is allowed to run for one scan */
  maxRays: number;
  mobile?: boolean; blurb: string;
}
export const LIDARS: LidarItem[] = [
  { id: 'rot16', name: 'Low-resolution rotating (16 ch)', preset: 'rot16', kind: 'low', cost: 200, noise: 0.04, dropout: 0.04, outliers: 0.012, maxRays: 120000, blurb: 'Cheap and sparse: 16 beams. Good for big objects, weak on small ones.' },
  { id: 'rot32', name: 'Medium-resolution rotating (32 ch)', preset: 'rot32', kind: 'medium', cost: 400, noise: 0.025, dropout: 0.03, outliers: 0.008, maxRays: 200000, blurb: '32 beams, ±22.5° vertical.' },
  { id: 'hdl64', name: 'Multi-channel long range (64 ch)', preset: 'hdl64e', kind: 'multi', cost: 800, noise: 0.02, dropout: 0.025, outliers: 0.006, maxRays: 250000, blurb: '64 beams, long range, narrow vertical view.' },
  { id: 'rot128', name: 'High-resolution rotating (128 ch)', preset: 'rot128', kind: 'high', cost: 1000, noise: 0.015, dropout: 0.02, outliers: 0.005, maxRays: 300000, blurb: '128 beams: dense. Expensive.' },
  { id: 'mid360', name: 'Solid-state wide (non-repeating scan)', preset: 'mid360', kind: 'solid', cost: 150, noise: 0.03, dropout: 0.04, outliers: 0.01, maxRays: 150000, blurb: 'No moving parts. Covers the upper hemisphere well, little below the horizon.' },
  { id: 'avia', name: 'Solid-state narrow, long range', preset: 'avia', kind: 'solid', cost: 500, noise: 0.025, dropout: 0.04, outliers: 0.01, maxRays: 150000, blurb: '70° wide: has to be aimed.' },
  { id: 'tls', name: 'TLS high-density scanner', preset: 'tls', kind: 'tls', cost: 5300, noise: 0.003, dropout: 0.01, outliers: 0.002, maxRays: 600000, blurb: 'Very dense and precise, but very expensive and slow.' },
  { id: 'tls-hire', name: 'Hire a TLS survey station', preset: 'tls', kind: 'tls', cost: 450, noise: 0.003, dropout: 0.01, outliers: 0.002, maxRays: 600000, blurb: 'One fixed surveyed station, at most two. Practice replays the same station; it cannot patrol the factory.' },
  { id: 'mobile32', name: 'Mobile LiDAR (32 ch), needs the platform', preset: 'rot32', kind: 'mobile', cost: 400, noise: 0.03, dropout: 0.03, outliers: 0.01, maxRays: 60000, mobile: true, blurb: 'Rides a platform along a route: many scans, drifting position.' },
];

export interface CameraItem {
  id: string; name: string; w: number; h: number; fov: number; cost: number;
  /** how much light becomes signal; electronic noise (0..255 scale); shot-noise factor */
  gain: number; read: number; shot: number; blurb: string;
}
export const CAMERAS: CameraItem[] = [
  { id: 'cam-basic', name: 'Basic RGB camera (320p)', w: 568, h: 320, fov: 70, cost: 40, gain: 1, read: 7, shot: 0.7, blurb: '568×320 pixels (320p).' },
  { id: 'cam-mid', name: 'Medium-resolution camera (720p)', w: 1280, h: 720, fov: 70, cost: 110, gain: 1, read: 6, shot: 0.7, blurb: '1280×720 pixels (720p, HD).' },
  { id: 'cam-high', name: 'High-resolution camera (4K)', w: 3840, h: 2160, fov: 70, cost: 325, gain: 1, read: 6, shot: 0.7, blurb: '3840×2160 pixels (4K). Many pixels, but it needs light like the others.' },
  { id: 'cam-wide', name: 'Wide-angle camera (720p)', w: 1280, h: 720, fov: 110, cost: 130, gain: 1, read: 6, shot: 0.7, blurb: '110° view at 720p: sees more, but each object gets fewer pixels.' },
  { id: 'cam-lowlight', name: 'Low-light camera (720p)', w: 1280, h: 720, fov: 70, cost: 250, gain: 4, read: 2.5, shot: 0.6, blurb: 'Big sensor at 720p: 4× the signal and less noise in the dark.' },
];
export const LOWLIGHT_KIT = { cost: 60, gain: 2.5, read: 0.6 };
export const LIGHT_UNIT = { cost: 45, power: 0.45 };
export const MOBILE_PLATFORM = { cost: 300 };
export const INSTALL = { lidar: 20, camera: 8, light: 5 };
export const LIMITS = { lidars: 6, cameras: 4, lights: 4 };

export type TaskKey = 'twin' | 'detect' | 'colour' | 'change' | 'quality' | 'safety' | 'budget';
export const TASK_KEYS: TaskKey[] = ['twin', 'detect', 'colour', 'change', 'quality', 'safety', 'budget'];
export const TASK_NAMES: Record<TaskKey, string> = { twin: 'Digital twin', detect: 'Object detection', colour: 'Colour-coded objects', change: 'Change detection', quality: 'Noise handling', safety: 'Safety and clearance', budget: 'Budget and efficiency' };
export interface ChallengeSettings { budget: number; priceScale: number; maxSubmissions: number; weights: Record<TaskKey, number>; enabled: Record<TaskKey, boolean> }
export const DEFAULT_SETTINGS: ChallengeSettings = {
  budget: 3000, priceScale: 1, maxSubmissions: 0, // 0 = grade as many times as you like
  weights: { twin: 20, detect: 20, colour: 10, change: 20, quality: 10, safety: 10, budget: 10 },
  enabled: { twin: true, detect: true, colour: true, change: true, quality: true, safety: true, budget: true },
};

// ----------------------------------------------------------------------------- what the team has bought and placed
export interface LidarUnit { id: string; item: string; res: ResTier; x: number; y: number; z: number; yaw: number; pitch: number }
export interface CameraCal { est: Extrinsic; fov: number; done: boolean }
export interface CameraUnit { id: string; item: string; x: number; y: number; z: number; yaw: number; pitch: number; kit: boolean; cal: CameraCal; pairedLidarId?: string }
export interface LightUnit { id: string; x: number; y: number; z: number }
export interface TwinDesign { lidars: LidarUnit[]; cameras: CameraUnit[]; lights: LightUnit[]; platform: boolean; route: [number, number][]; routeSteps: number; distortion: boolean }
export const EMPTY_DESIGN: TwinDesign = { lidars: [], cameras: [], lights: [], platform: false, route: [[-9, -0.3], [9, -0.3]], routeSteps: 10, distortion: true };

export const lidarItem = (id: string) => LIDARS.find((l) => l.id === id) ?? LIDARS[0];
export const cameraItem = (id: string) => CAMERAS.find((c) => c.id === id) ?? CAMERAS[0];
export const isMobile = (u: LidarUnit) => !!lidarItem(u.item).mobile;
/** Legacy cameras use their nearest scanner until the student explicitly pairs them. */
export const pairedLidarOf = (c: CameraUnit, d: TwinDesign): LidarUnit | undefined => c.pairedLidarId ? d.lidars.find((u) => u.id === c.pairedLidarId) : d.lidars.reduce<LidarUnit | undefined>((best, u) => !best || Math.hypot(u.x - c.x, u.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? u : best, undefined);

export interface CostLine { label: string; cost: number }
export interface CostReport { lines: CostLine[]; total: number; remaining: number; errors: string[]; warnings: string[]; ok: boolean }

/** Prices and rules in one place, so the shop, the checks and the grader cannot disagree. */
export function costOf(d: TwinDesign, s: ChallengeSettings): CostReport {
  const lines: CostLine[] = [], k = s.priceScale, errors: string[] = [], warnings: string[] = [];
  const add = (label: string, c: number) => lines.push({ label, cost: Math.round(c * k) });
  d.lidars.forEach((u, i) => {
    const it = lidarItem(u.item); add(`${it.name} (${RES_TIERS[u.res].label.split(' ')[0].toLowerCase()})`, it.cost * RES_TIERS[u.res].cost); add(`Install LiDAR ${i + 1}`, INSTALL.lidar);
  });
  d.cameras.forEach((c, i) => { const it = cameraItem(c.item); add(it.name, it.cost); if (c.kit) add(`Low-light kit on camera ${i + 1}`, LOWLIGHT_KIT.cost); add(`Install camera ${i + 1}`, INSTALL.camera); });
  d.lights.forEach((_, i) => { add(`Lighting unit ${i + 1}`, LIGHT_UNIT.cost); add(`Install light ${i + 1}`, INSTALL.light); });
  if (d.platform) add('Mobile scanning platform', MOBILE_PLATFORM.cost);
  const total = lines.reduce((a, l) => a + l.cost, 0), mobiles = d.lidars.filter(isMobile).length;
  if (d.lidars.length > LIMITS.lidars) errors.push(`At most ${LIMITS.lidars} LiDARs.`);
  if (d.cameras.length > LIMITS.cameras) errors.push(`At most ${LIMITS.cameras} cameras.`);
  if (d.lights.length > LIMITS.lights) errors.push(`At most ${LIMITS.lights} lighting units.`);
  if (d.lidars.filter((u) => u.item === 'tls-hire').length > 2) errors.push('At most two hired TLS survey stations.');
  if (mobiles > 1) errors.push('Only one mobile LiDAR fits on the platform.');
  if (mobiles && !d.platform) errors.push('A mobile LiDAR needs the mobile scanning platform.');
  if (d.platform && !mobiles) warnings.push('You bought the mobile platform but no mobile LiDAR.');
  if (!d.lidars.length) errors.push('Buy and place at least one LiDAR.');
  if (total > s.budget) errors.push(`Over budget by ${usd(total - s.budget)}.`);
  return { lines, total, remaining: s.budget - total, errors, warnings, ok: errors.length === 0 };
}

/** The sensor configuration a unit really runs with: the preset, with its angular resolution and range noise from the catalogue. */
export function sensorFor(u: LidarUnit): SensorConfig {
  const it = lidarItem(u.item), base = presetToConfig(getPreset(it.preset)), t = RES_TIERS[u.res].hRes;
  return { ...base, hRes: base.hRes * t, noise: it.noise };
}
/** Hardware seed: installation errors belong to the equipment, so a calibration made in practice is still right in the final evaluation. */
export const HW_SEED = 7;
export const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 7)}`;
