/**
 * Everything you may want to change about the intro screen lives here.
 * (The small inline script in index.html repeats storageKey and the cooldown: keep them in step.)
 */
/** How long after the intro was last shown before it is shown again. */
export const INTRO_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export const INTRO = {
  /** 'cooldown': shown on the first visit, then not again until INTRO_COOLDOWN_MS after it was last shown (across refreshes and tabs). 'always': every page load. 'never': switched off. */
  show: 'cooldown' as 'cooldown' | 'always' | 'never',
  cooldownMs: INTRO_COOLDOWN_MS,
  /** localStorage key holding the time (ms since 1970) the intro was last shown. */
  storageKey: 'lidar-lab-intro-last',
  /** The intro stays at least this long, even if the app is ready sooner. */
  minMs: 2800,
  /** With "reduce motion" switched on in the system, a calmer and shorter intro is used. */
  reducedMinMs: 1200,
  /** Safety net: if the app has not reported itself ready after this long, the intro lets go anyway. */
  maxWaitMs: 15000,
  /** How long the fade-out takes (keep in step with --intro-leave in intro.css). */
  leaveMs: 750,
  title: 'LiDAR Learning Lab',
  tagline: 'Explore the world in 3D',
  detail: 'Interactive LiDAR, point clouds, SLAM, fusion, and spatial AI',
} as const;
