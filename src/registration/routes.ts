/** Ready-made trajectories and speed limits for the mobile platforms, so a route can be tested without placing waypoints. */
export type Platform = 'handheld' | 'vehicle' | 'uav';
export type Bounds = { min: number[]; max: number[] };
export interface RoutePreset { id: string; label: string; hint: string; wps: [number, number][] }

/** Speed range (m/s) and default for each platform: walking, urban driving, survey drone. */
export const SPEEDS: Record<Platform, { min: number; max: number; def: number; step: number; note: string }> = {
  handheld: { min: 0.4, max: 2, def: 1.2, step: 0.1, note: 'Walking pace: 0.4 to 2 m/s.' },
  vehicle: { min: 2, max: 14, def: 7, step: 1, note: 'Slow urban driving: 2 to 14 m/s (up to about 50 km/h).' },
  uav: { min: 1, max: 15, def: 5, step: 1, note: 'Survey drone: 1 to 15 m/s.' },
};

export const routeLength = (w: [number, number][]) => w.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - w[i - 1][0], p[1] - w[i - 1][1]) : 0), 0);

export function presetRoutes(sceneId: string, b: Bounds, platform: Platform): RoutePreset[] {
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  const rect = (fx: number, fy: number): [number, number][] => [[cx - w * fx, cy - h * fy], [cx + w * fx, cy - h * fy], [cx + w * fx, cy + h * fy], [cx - w * fx, cy + h * fy], [cx - w * fx, cy - h * fy]];
  const city = sceneId === 'D';
  const loop = (fx: number, fy: number): [number, number][] => city ? [[-14, 0], [14, 0], [14, 24], [-14, 24], [-14, 0]] : rect(fx, fy);
  const zig = (fx: number, fy: number): [number, number][] => city ? [[-32, -2], [-8, 2], [10, -2], [32, 2]] : [[cx - w * fx, cy - h * fy], [cx + w * fx, cy - h * fy * 0.4], [cx - w * fx, cy + h * fy * 0.2], [cx + w * fx, cy + h * fy]];
  if (platform === 'handheld') return [
    { id: 'walk-loop', label: 'Walk a loop', hint: 'Closed walk that returns to the start: good for loop closure.', wps: loop(0.3, 0.26) },
    { id: 'walk-zig', label: 'Zig-zag walk', hint: 'Open route with turns and no return.', wps: zig(0.32, 0.26) },
  ];
  if (platform === 'vehicle') return [
    { id: 'drive-loop', label: 'Drive around the block', hint: 'Large closed loop at street level.', wps: loop(0.36, 0.34) },
    { id: 'drive-out', label: 'Out and back', hint: 'Straight run and the same road back.', wps: city ? [[-30, 0], [30, 0], [-30, 0]] : [[cx - w * 0.38, cy], [cx + w * 0.38, cy], [cx - w * 0.38, cy]] },
  ];
  const lines: [number, number][] = city ? [[-30, -2], [30, -2], [30, 12], [-30, 12], [-30, 26], [30, 26]] : [[cx - w * 0.38, cy - h * 0.36], [cx + w * 0.38, cy - h * 0.36], [cx + w * 0.38, cy], [cx - w * 0.38, cy], [cx - w * 0.38, cy + h * 0.36], [cx + w * 0.38, cy + h * 0.36]];
  const rx = city ? 22 : w * 0.3, ry = city ? 16 : h * 0.3, ox = city ? 0 : cx, oy = city ? 12 : cy;
  const orbit: [number, number][] = Array.from({ length: 9 }, (_, i) => { const a = (i % 8) / 8 * 2 * Math.PI; return [ox + rx * Math.cos(a), oy + ry * Math.sin(a)] as [number, number]; });
  return [
    { id: 'uav-survey', label: 'Survey lines', hint: 'Lawn-mower pattern that covers the whole area.', wps: lines },
    { id: 'uav-orbit', label: 'Orbit', hint: 'Closed circle around the middle of the scene.', wps: orbit },
  ];
}

/** The three mobile LiDARs of the SLAM tab. `sim` is a thinned copy of the real preset so the browser can map quickly. */
export type SlamLidarId = 'vlp16' | 'hokuyo' | 'mid360';
export const SLAM_LIDARS: { id: SlamLidarId; preset: string; label: string; kind: string; note: string; sim: { hRes: number; channels: number; maxRange: number; noise: number } }[] = [
  { id: 'vlp16', preset: 'rot16', label: 'Velodyne Puck VLP-16', kind: '3D rotating', note: '16 channels, full 360°, 10 scans per second. The standard mobile mapping scanner.', sim: { hRes: 2, channels: 6, maxRange: 60, noise: 0.005 } },
  { id: 'hokuyo', preset: 'planar', label: 'Hokuyo UTM-30LX', kind: '2D line scanner', note: 'One flat 270° slice, 40 scans per second. Many scans, but each sees only a thin ring.', sim: { hRes: 1.5, channels: 1, maxRange: 30, noise: 0.01 } },
  { id: 'mid360', preset: 'mid360', label: 'Livox Mid-360', kind: 'Solid-state', note: 'No spinning mirror: a non-repeating pattern, 10 scans per second, upper hemisphere.', sim: { hRes: 8, channels: 24, maxRange: 40, noise: 0.01 } },
];
/** The most scans matched in the browser; the rest are captured but not used for the map. */
export const MAX_MAP_SCANS = 50;
/** A mobile LiDAR scans at its own rate while moving: time on route times scan rate. */
export function slamPlan(length: number, speed: number, hz: number) {
  const duration = speed > 0 ? length / speed : 0, captured = Math.max(1, Math.round(duration * hz));
  const used = Math.min(MAX_MAP_SCANS, Math.max(6, captured));
  return { duration, captured, used, steps: used - 1, spacing: length / Math.max(1, used - 1), thinned: captured > used };
}
