export type Pattern = 'planar' | 'rotating' | 'hybrid' | 'solidstate' | 'risley' | 'mems' | 'array' | 'panoramic';
/** Patterns whose beam count per sweep is fixed by the scanner (not by an azimuth step). */
export const isSteered = (p: Pattern) => p === 'solidstate' || p === 'risley' || p === 'mems';

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

export interface PresetExample { label: string; patch: Partial<SensorConfig> }

export interface SensorPreset extends SensorConfig {
  group: string;
  blurb: string;
  /** 2–3 typical configurations of this kind of scanner; clicking one applies it. */
  examples: PresetExample[];
}

export const PRESETS: SensorPreset[] = [
  {
    id: 'tls', group: 'Terrestrial (TLS) · Mechanical', name: "Leica RTC360", pattern: 'panoramic', hFov: 360, vMin: -60, vMax: 90, hRes: 0.12, channels: 220, minRange: 0.5, maxRange: 130, frequency: 0.02, returns: 1, noise: 0.002, reflectivityOverride: null,
    blurb: "Tripod laser scanner, 360\u00b0 \u00d7 300\u00b0 field of view. Records colour as well as intensity.",
    examples: [
      { label: "High density \u00b7 0.1\u00b0", patch: { hRes: 0.1, channels: 300 } },
      { label: "Medium \u00b7 0.2\u00b0", patch: { hRes: 0.2, channels: 160 } },
      { label: "Fast / low density \u00b7 0.4\u00b0", patch: { hRes: 0.4, channels: 80 } },
    ],
  },
  {
    id: 'faro', group: 'Terrestrial (TLS) · Mechanical', name: "FARO Focus Premium", pattern: 'panoramic', hFov: 360, vMin: -60, vMax: 90, hRes: 0.12, channels: 220, minRange: 0.5, maxRange: 350, frequency: 0.02, returns: 1, noise: 0.001, reflectivityOverride: null,
    blurb: "Tripod laser scanner, 360\u00b0 \u00d7 300\u00b0 field of view. Records colour as well as intensity.",
    examples: [
      { label: "High density \u00b7 0.1\u00b0", patch: { hRes: 0.1, channels: 300 } },
      { label: "Medium \u00b7 0.2\u00b0", patch: { hRes: 0.2, channels: 160 } },
      { label: "Fast / low density \u00b7 0.4\u00b0", patch: { hRes: 0.4, channels: 80 } },
    ],
  },


  {
    id: 'planar', group: 'Mobile (MLS) · Mechanical · 2D', name: "Hokuyo UTM-30LX", pattern: 'planar', hFov: 270, vMin: 0, vMax: 0, hRes: 0.25, channels: 1, minRange: 0.05, maxRange: 30, frequency: 40, returns: 1, noise: 0.03, reflectivityOverride: null,
    blurb: "2D scanner: one beam swept in a single plane. Gives a slice, not a 3D cloud.",
    examples: [
      { label: "Full 270\u00b0 \u00b7 0.25\u00b0", patch: { hFov: 270, hRes: 0.25 } },
      { label: "Coarse \u00b7 0.5\u00b0", patch: { hFov: 270, hRes: 0.5 } },
    ],
  },
  {
    id: 'tim571', group: 'Mobile (MLS) · Mechanical · 2D', name: "SICK TiM571", pattern: 'planar', hFov: 270, vMin: 0, vMax: 0, hRes: 0.33, channels: 1, minRange: 0.05, maxRange: 25, frequency: 15, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "2D scanner: one beam swept in a single plane. Gives a slice, not a 3D cloud.",
    examples: [
      { label: "Full 270\u00b0 \u00b7 0.33\u00b0", patch: { hFov: 270, hRes: 0.33 } },
      { label: "Front 90\u00b0 \u00b7 0.33\u00b0", patch: { hFov: 90, hRes: 0.33 } },
    ],
  },

  {
    id: 'ldmrs', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "SICK LD-MRS (4 layers)", pattern: 'rotating', hFov: 110, vMin: -1.6, vMax: 1.6, hRes: 0.25, channels: 4, minRange: 0.5, maxRange: 200, frequency: 12.5, returns: 1, noise: 0.04, reflectivityOverride: null,
    blurb: "Four-layer automotive scanner with a 110\u00b0 horizontal window.",
    examples: [
      { label: "Standard \u00b7 0.25\u00b0 \u00b7 12.5 Hz", patch: { hRes: 0.25, frequency: 12.5 } },
      { label: "Fast \u00b7 0.5\u00b0 \u00b7 50 Hz", patch: { hRes: 0.5, frequency: 50 } },
    ],
  },
  {
    id: 'lux', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Ibeo LUX (4 layers)", pattern: 'rotating', hFov: 110, vMin: -1.6, vMax: 1.6, hRes: 0.25, channels: 4, minRange: 0.5, maxRange: 200, frequency: 12.5, returns: 1, noise: 0.04, reflectivityOverride: null,
    blurb: "Four-layer automotive scanner with a 110\u00b0 horizontal window.",
    examples: [
      { label: "Standard \u00b7 0.25\u00b0 \u00b7 12.5 Hz", patch: { hRes: 0.25, frequency: 12.5 } },
      { label: "Fast \u00b7 0.5\u00b0 \u00b7 50 Hz", patch: { hRes: 0.5, frequency: 50 } },
    ],
  },
  {
    id: 'rot16', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Velodyne Puck VLP-16", pattern: 'rotating', hFov: 360, vMin: -15, vMax: 15, hRes: 0.2, channels: 16, minRange: 0.5, maxRange: 100, frequency: 10, returns: 1, noise: 0.03, reflectivityOverride: null,
    blurb: "16 channels, \u00b115\u00b0 vertical, 360\u00b0 rotation.",
    examples: [
      { label: "10 Hz \u00b7 0.2\u00b0", patch: { frequency: 10, hRes: 0.2 } },
      { label: "5 Hz \u00b7 0.1\u00b0", patch: { frequency: 5, hRes: 0.1 } },
      { label: "20 Hz \u00b7 0.4\u00b0", patch: { frequency: 20, hRes: 0.4 } },
    ],
  },
  {
    id: 'm8u', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Quanergy M8 Ultra (8 channels)", pattern: 'rotating', hFov: 360, vMin: -18, vMax: 3, hRes: 0.3, channels: 8, minRange: 0.5, maxRange: 200, frequency: 10, returns: 1, noise: 0.03, reflectivityOverride: null,
    blurb: "16 channels, \u00b115\u00b0 vertical, 360\u00b0 rotation.",
    examples: [
      { label: "10 Hz \u00b7 0.2\u00b0", patch: { frequency: 10, hRes: 0.2 } },
      { label: "5 Hz \u00b7 0.1\u00b0", patch: { frequency: 5, hRes: 0.1 } },
      { label: "20 Hz \u00b7 0.4\u00b0", patch: { frequency: 20, hRes: 0.4 } },
    ],
  },
  {
    id: 'm8', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Quanergy M8 (8 channels)", pattern: 'rotating', hFov: 360, vMin: -18, vMax: 3, hRes: 0.3, channels: 8, minRange: 0.5, maxRange: 150, frequency: 10, returns: 1, noise: 0.03, reflectivityOverride: null,
    blurb: "16 channels, \u00b115\u00b0 vertical, 360\u00b0 rotation.",
    examples: [
      { label: "10 Hz \u00b7 0.2\u00b0", patch: { frequency: 10, hRes: 0.2 } },
      { label: "5 Hz \u00b7 0.1\u00b0", patch: { frequency: 5, hRes: 0.1 } },
      { label: "20 Hz \u00b7 0.4\u00b0", patch: { frequency: 20, hRes: 0.4 } },
    ],
  },
  {
    id: 'rs16', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "RoboSense RS-LiDAR-16", pattern: 'rotating', hFov: 360, vMin: -15, vMax: 15, hRes: 0.2, channels: 16, minRange: 0.5, maxRange: 150, frequency: 10, returns: 1, noise: 0.03, reflectivityOverride: null,
    blurb: "16 channels, \u00b115\u00b0 vertical, 360\u00b0 rotation.",
    examples: [
      { label: "10 Hz \u00b7 0.2\u00b0", patch: { frequency: 10, hRes: 0.2 } },
      { label: "20 Hz \u00b7 0.4\u00b0", patch: { frequency: 20, hRes: 0.4 } },
    ],
  },
  {
    id: 'hdl32e', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Velodyne HDL-32E", pattern: 'rotating', hFov: 360, vMin: -30.67, vMax: 10.67, hRes: 0.2, channels: 32, minRange: 0.5, maxRange: 100, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "32 channels, +10.7\u00b0 to \u221230.7\u00b0 vertical.",
    examples: [
      { label: "10 Hz \u00b7 0.2\u00b0", patch: { frequency: 10, hRes: 0.2 } },
      { label: "5 Hz \u00b7 0.1\u00b0", patch: { frequency: 5, hRes: 0.1 } },
    ],
  },

  {
    id: 'rot32', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Ouster OS1-32", pattern: 'rotating', hFov: 360, vMin: -22.5, vMax: 22.5, hRes: 0.35, channels: 32, minRange: 0.5, maxRange: 90, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "32 channels, 45\u00b0 vertical field of view.",
    examples: [
      { label: "1024 columns \u00b7 10 Hz", patch: { hRes: 0.352, frequency: 10 } },
      { label: "2048 columns \u00b7 10 Hz", patch: { hRes: 0.176, frequency: 10 } },
      { label: "512 columns \u00b7 20 Hz", patch: { hRes: 0.703, frequency: 20 } },
    ],
  },
  {
    id: 'rot64', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Ouster OS1-64", pattern: 'rotating', hFov: 360, vMin: -22.5, vMax: 22.5, hRes: 0.35, channels: 64, minRange: 0.5, maxRange: 90, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "64 channels, 45\u00b0 vertical field of view.",
    examples: [
      { label: "1024 columns \u00b7 10 Hz", patch: { hRes: 0.352, frequency: 10 } },
      { label: "2048 columns \u00b7 10 Hz", patch: { hRes: 0.176, frequency: 10 } },
      { label: "512 columns \u00b7 20 Hz", patch: { hRes: 0.703, frequency: 20 } },
    ],
  },
  {
    id: 'rot128', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Ouster OS1-128", pattern: 'rotating', hFov: 360, vMin: -22.5, vMax: 22.5, hRes: 0.35, channels: 128, minRange: 0.5, maxRange: 90, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "128 channels, 45\u00b0 vertical field of view.",
    examples: [
      { label: "1024 columns \u00b7 10 Hz", patch: { hRes: 0.352, frequency: 10 } },
      { label: "2048 columns \u00b7 10 Hz", patch: { hRes: 0.176, frequency: 10 } },
      { label: "512 columns \u00b7 20 Hz", patch: { hRes: 0.703, frequency: 20 } },
    ],
  },

  {
    id: 'hdl64e', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Velodyne HDL-64E", pattern: 'rotating', hFov: 360, vMin: -24.9, vMax: 2, hRes: 0.2, channels: 64, minRange: 0.5, maxRange: 120, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "64 channels, 26.9\u00b0 vertical field of view.",
    examples: [
      { label: "10 Hz \u00b7 0.2\u00b0", patch: { frequency: 10, hRes: 0.2 } },
      { label: "5 Hz \u00b7 0.1\u00b0", patch: { frequency: 5, hRes: 0.1 } },
    ],
  },


  {
    id: 'vls128', group: 'Mobile (MLS) · Mechanical · Multi-channel', name: "Velodyne Alpha Prime (VLS-128)", pattern: 'rotating', hFov: 360, vMin: -25, vMax: 15, hRes: 0.2, channels: 128, minRange: 0.5, maxRange: 245, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "128 channels, 40\u00b0 vertical field of view, long range.",
    examples: [
      { label: "10 Hz \u00b7 0.2\u00b0", patch: { frequency: 10, hRes: 0.2 } },
      { label: "20 Hz \u00b7 0.4\u00b0", patch: { frequency: 20, hRes: 0.4 } },
    ],
  },
  {
    id: 'mid360', group: 'Mobile (MLS) · Prism (non-repeating)', name: "Livox Mid-360", pattern: 'risley', hFov: 360, vMin: -7, vMax: 52, hRes: 0.7, channels: 56, minRange: 0.3, maxRange: 40, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "360\u00b0 \u00d7 59\u00b0 field of view, about 200 000 points/s. Non-repeating pattern that fills in as it runs.",
    examples: [
      { label: "0.1 s \u00b7 single sweep", patch: { channels: 56 } },
      { label: "Denser \u00b7 more points", patch: { channels: 110 } },
    ],
  },
  {
    id: 'avia', group: 'Mobile (MLS) · Prism (non-repeating)', name: "Livox Avia", pattern: 'risley', hFov: 70.4, vMin: -38.6, vMax: 38.6, hRes: 0.7, channels: 238, minRange: 0.3, maxRange: 190, frequency: 10, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "About 70\u00b0 circular forward field of view, 240 000 points/s. Non-repeating pattern that fills in as it runs.",
    examples: [
      { label: "Standard", patch: { channels: 238 } },
      { label: "Dense", patch: { channels: 420 } },
    ],
  },


  {
    id: 'cube1', group: 'Mobile (MLS) · MEMS micro-mirror', name: "Blickfeld Cube 1", pattern: 'mems', hFov: 70, vMin: -15, vMax: 15, hRes: 0.7, channels: 194, minRange: 0.3, maxRange: 75, frequency: 5, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "MEMS micro-mirror: sinusoidal horizontal sweep, eye-shaped coverage. About 70\u00b0 \u00d7 30\u00b0, 200 scan lines.",
    examples: [
      { label: "5 Hz \u00b7 200 lines", patch: { frequency: 5, channels: 194 } },
      { label: "Fast \u00b7 10 Hz", patch: { frequency: 10, channels: 120 } },
    ],
  },
  {
    id: 'ft120', group: 'Mobile (MLS) · Solid-state array', name: "Hesai FT120", pattern: 'array', hFov: 100, vMin: -37.5, vMax: 37.5, hRes: 0.8, channels: 96, minRange: 0.3, maxRange: 100, frequency: 10, returns: 1, noise: 0.015, reflectivityOverride: null,
    blurb: "Solid-state array: a fixed grid of beams, identical every frame. About 100\u00b0 \u00d7 75\u00b0.",
    examples: [
      { label: "Standard grid", patch: { channels: 96, hRes: 0.8 } },
      { label: "Fine grid", patch: { channels: 150, hRes: 0.5 } },
    ],
  },
  {
    id: 'h800', group: 'Mobile (MLS) · Solid-state array', name: "Velodyne Velarray H800", pattern: 'array', hFov: 120, vMin: -8, vMax: 8, hRes: 0.5, channels: 32, minRange: 0.3, maxRange: 200, frequency: 25, returns: 1, noise: 0.02, reflectivityOverride: null,
    blurb: "Solid-state array: wide 120\u00b0 \u00d7 16\u00b0 window for driving.",
    examples: [
      { label: "Standard", patch: { hRes: 0.5, channels: 32 } },
      { label: "Fine", patch: { hRes: 0.3, channels: 48 } },
    ],
  },
];

export const getPreset = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[1];
export const presetToConfig = (p: SensorPreset): SensorConfig => {
  const { blurb: _b, examples: _e, group: _g, ...cfg } = p;
  void _b; void _e; void _g;
  return { ...cfg };
};

export function raysPerSweep(s: SensorConfig): number {
  const cols = s.pattern === 'planar' || s.hFov >= 360 ? Math.round(s.hFov / s.hRes) : Math.floor(s.hFov / s.hRes) + 1;
  return Math.max(1, cols) * Math.max(1, s.channels);
}
export const pointsPerSecond = (s: SensorConfig) => raysPerSweep(s) * s.frequency;

export const PRESET_GROUPS: string[] = ['Terrestrial (TLS) · Mechanical', 'Mobile (MLS) · Mechanical · 2D', 'Mobile (MLS) · Mechanical · Multi-channel', 'Mobile (MLS) · Prism (non-repeating)', 'Mobile (MLS) · MEMS micro-mirror', 'Mobile (MLS) · Solid-state array'];

export interface SensorFamily { id: string; label: string; models: string[] }
/** Generic scanner types shown first; each lists up to two commercial models of that type. */
export const FAMILIES: SensorFamily[] = [
  { id: 'planar', label: '2D planar scanner', models: ['planar', 'tim571'] },
  { id: 'c4', label: '4-channel rotating', models: ['ldmrs', 'lux'] },
  { id: 'c8', label: '8-channel rotating', models: ['m8', 'm8u'] },
  { id: 'c16', label: '16-channel rotating', models: ['rot16', 'rs16'] },
  { id: 'c32', label: '32-channel rotating', models: ['hdl32e', 'rot32'] },
  { id: 'c64', label: '64-channel rotating', models: ['rot64', 'hdl64e'] },
  { id: 'c128', label: '128-channel rotating', models: ['rot128', 'vls128'] },
  { id: 'tls', label: 'Tripod laser scanner (TLS)', models: ['tls', 'faro'] },
  { id: 'prism', label: 'Prism (non-repeating) scanner', models: ['mid360', 'avia'] },
  { id: 'mems', label: 'MEMS micro-mirror scanner', models: ['cube1'] },
  { id: 'array', label: 'Solid-state array', models: ['ft120', 'h800'] },
];
export const familyOf = (presetId: string) => FAMILIES.find((f) => f.models.includes(presetId)) ?? FAMILIES[3];

export const FAMILY_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Mobile scanning (MLS)', ids: ['planar', 'c4', 'c8', 'c16', 'c32', 'c64', 'c128', 'prism', 'mems', 'array'] },
  { label: 'Terrestrial scanning (TLS)', ids: ['tls'] },
];
/** Mechanical scanners are listed under MLS with a "Mechanical ·" prefix. */
export const familyLabel = (id: string) => {
  const f = FAMILIES.find((x) => x.id === id)!;
  return ['planar', 'c4', 'c8', 'c16', 'c32', 'c64', 'c128'].includes(id) ? `Mechanical · ${f.label}` : f.label;
};
