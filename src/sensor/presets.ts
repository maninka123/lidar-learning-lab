export type Pattern = 'planar' | 'rotating' | 'hybrid' | 'solidstate' | 'panoramic';

export interface SensorConfig {
  id: string;
  name: string;
  pattern: Pattern;
  hFov: number; // total horizontal FOV, deg
  vMin: number; // lowest beam elevation, deg
  vMax: number; // highest beam elevation, deg
  hRes: number; // horizontal angular resolution, deg
  channels: number; // vertical channels (beams per column)
  minRange: number;
  maxRange: number; // range for a bright (80 %) target
  frequency: number; // sweeps (rotations) per second
  returns: 1 | 2 | 3;
  noise: number; // 1-sigma range noise, m
  reflectivityOverride: number | null; // null = use each material's reflectivity
}

export interface SensorProfile {
  vendor: string;
  verified: { label: string; value: string }[];
  simplifications: string[];
}

export interface SensorPreset extends SensorConfig {
  blurb: string;
  profile?: SensorProfile;
}

const base = { vMin: 0, vMax: 0, returns: 1 as const, noise: 0.01, reflectivityOverride: null };

export const PRESETS: SensorPreset[] = [
  {
    ...base, id: 'planar', name: '2D planar scanner', pattern: 'planar', hFov: 270, hRes: 0.5, channels: 1, minRange: 0.1, maxRange: 30, frequency: 25, noise: 0.02,
    blurb: 'One beam swept in a single plane (like a safety / AGV scanner). Gives a slice, not a 3D cloud.',
  },
  {
    ...base, id: 'rot16', name: '16-channel rotating', pattern: 'rotating', hFov: 360, hRes: 0.4, vMin: -15, vMax: 15, channels: 16, minRange: 0.5, maxRange: 100, frequency: 10,
    blurb: 'Sixteen laser/detector pairs on a spinning head. Sparse vertical sampling.',
  },
  {
    ...base, id: 'rot32', name: '32-channel rotating', pattern: 'rotating', hFov: 360, hRes: 0.35, vMin: -22.5, vMax: 22.5, channels: 32, minRange: 0.5, maxRange: 90, frequency: 10,
    blurb: 'Mid-density rotating scanner.',
  },
  {
    ...base, id: 'rot64', name: '64-channel rotating', pattern: 'rotating', hFov: 360, hRes: 0.35, vMin: -22.5, vMax: 22.5, channels: 64, minRange: 0.5, maxRange: 90, frequency: 10,
    blurb: 'Dense rotating scanner; point count grows with channels × columns.',
  },
  {
    ...base, id: 'rot128', name: '128-channel rotating', pattern: 'rotating', hFov: 360, hRes: 0.35, vMin: -22.5, vMax: 22.5, channels: 128, minRange: 0.5, maxRange: 90, frequency: 10,
    blurb: 'Very dense rotating scanner. The point budget may thin this out.',
  },
  {
    ...base, id: 'hybrid', name: 'Hybrid rotating-mirror (illustrative)', pattern: 'hybrid', hFov: 120, hRes: 0.3, vMin: -12, vMax: 12, channels: 8, minRange: 0.5, maxRange: 120, frequency: 10,
    blurb: 'Fixed beam fan whose elevation is modulated by an oscillating mirror, swept across a limited azimuth window.',
  },
  {
    ...base, id: 'solid', name: 'Forward-facing solid-state (illustrative)', pattern: 'solidstate', hFov: 70, hRes: 0.7, vMin: -35, vMax: 35, channels: 100, minRange: 0.3, maxRange: 60, frequency: 10,
    blurb: 'No spinning head: a steered beam draws a non-repeating rosette over a forward window. Coverage builds as sweeps accumulate.',
  },
  {
    ...base, id: 'tls', name: 'Panoramic TLS', pattern: 'panoramic', hFov: 360, hRes: 0.3, vMin: -60, vMax: 60, channels: 100, minRange: 0.5, maxRange: 120, frequency: 0.02, noise: 0.004,
    blurb: 'Tripod-mounted terrestrial scanner: slow, dense, near-spherical field of view with millimetre-level range noise.',
  },
  {
    ...base, id: 'vlp16', name: 'Velodyne VLP-16 (example profile)', pattern: 'rotating', hFov: 360, hRes: 0.2, vMin: -15, vMax: 15, channels: 16, minRange: 0.5, maxRange: 100, frequency: 10, noise: 0.03,
    blurb: 'Example profile loosely based on the public VLP-16 datasheet.',
    profile: {
      vendor: 'Velodyne (Ouster)',
      verified: [
        { label: 'Channels', value: '16' },
        { label: 'Vertical FOV', value: '±15° (30° total), 2° spacing' },
        { label: 'Horizontal FOV', value: '360°' },
        { label: 'Rotation rate', value: '5–20 Hz (azimuth res 0.1°–0.4°)' },
        { label: 'Range', value: 'up to 100 m' },
        { label: 'Accuracy', value: '±3 cm (typical)' },
        { label: 'Point rate', value: '≈300 000 pts/s (single return)' },
      ],
      simplifications: [
        'Beam elevations are evenly spaced; the real unit has a fixed non-uniform firing order.',
        'Noise is a simple Gaussian on range; no multipath, crosstalk or calibrated intensity.',
        'Range is scaled with a simple reflectivity law, not the vendor\'s link budget.',
        'Minimum range (0.5 m here) is a simulator default, not a verified value.',
        'Values are from public datasheets as of writing — re-check the current datasheet before quoting.',
      ],
    },
  },
  {
    ...base, id: 'os1', name: 'Ouster OS1-64 (example profile)', pattern: 'rotating', hFov: 360, hRes: 0.352, vMin: -22.5, vMax: 22.5, channels: 64, minRange: 0.5, maxRange: 90, frequency: 10, noise: 0.02,
    blurb: 'Example profile loosely based on the public OS1 family datasheet.',
    profile: {
      vendor: 'Ouster',
      verified: [
        { label: 'Channels', value: '32 / 64 / 128 (model dependent)' },
        { label: 'Vertical FOV', value: '45° (±22.5°)' },
        { label: 'Horizontal FOV', value: '360°' },
        { label: 'Horizontal modes', value: '512 / 1024 / 2048 columns at 10 or 20 Hz' },
        { label: 'Range', value: 'roughly 90–170 m depending on model & target reflectivity' },
      ],
      simplifications: [
        'Digital-lidar beam-to-pixel alignment is idealised as an even beam grid.',
        'Range is capped at 90 m here regardless of model; noise is Gaussian only.',
        'Dual-return behaviour is approximated by the generic multi-return model.',
        'Values are from public datasheets as of writing — verify against the current datasheet.',
      ],
    },
  },
  {
    ...base, id: 'mid360', name: 'Livox Mid-360 (example profile)', pattern: 'solidstate', hFov: 360, hRes: 6.4, vMin: -7, vMax: 52, channels: 56, minRange: 0.1, maxRange: 40, frequency: 10, noise: 0.02,
    blurb: 'Example profile loosely based on the public Mid-360 datasheet. The scan pattern here is an illustrative rosette, NOT the real Livox pattern.',
    profile: {
      vendor: 'Livox',
      verified: [
        { label: 'Horizontal FOV', value: '360°' },
        { label: 'Vertical FOV', value: '−7° … +52° (59° total)' },
        { label: 'Point rate', value: '≈200 000 pts/s' },
        { label: 'Range', value: '≈40 m at 10 % reflectivity' },
        { label: 'Blind zone', value: '≈0.1 m' },
        { label: 'Pattern', value: 'non-repetitive (coverage accumulates over time)' },
      ],
      simplifications: [
        'The real non-repetitive pattern is proprietary; the simulator uses a generic Lissajous rosette.',
        'Range here is for an 80 % target in this simulator’s reflectivity law, not 10 %.',
        'Point rate is approximated by hFov/hRes × channels × frequency.',
        'Do not claim this pattern reproduces the commercial sensor.',
      ],
    },
  },
];

export const getPreset = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[1];
export const presetToConfig = (p: SensorPreset): SensorConfig => {
  const { blurb: _b, profile: _p, ...cfg } = p;
  void _b; void _p;
  return { ...cfg };
};

export function raysPerSweep(s: SensorConfig): number {
  const cols = s.pattern === 'planar' || s.hFov >= 360 ? Math.round(s.hFov / s.hRes) : Math.floor(s.hFov / s.hRes) + 1;
  return Math.max(1, cols) * Math.max(1, s.channels);
}
export const pointsPerSecond = (s: SensorConfig) => raysPerSweep(s) * s.frequency;
