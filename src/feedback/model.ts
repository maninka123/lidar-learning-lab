/** The feedback questionnaire: what is asked, how an answer is checked, and what is sent. No names, no accounts: only ratings, a module and a comment. */

export const TOPICS = [
  { key: 'lidar', label: 'Overall understanding of LiDAR technology and 3D scanning' },
  { key: 'processing', label: 'Understanding of point cloud processing, registration and 3D mapping' },
  { key: 'applications', label: 'Understanding of LiDAR applications, sensor fusion and AI' },
] as const;

/** 1 to 5, the same wording for every Before and After rating. */
export const SCALE = ['No understanding', 'Basic understanding', 'Moderate understanding', 'Good understanding', 'Excellent understanding'] as const;

/** Stable ids, in step with workshop-backend/lib/feedback.ts (a test keeps the two lists equal). The labels follow the lab's tabs. */
export const MODULES: { id: string; label: string }[] = [
  { id: 'fundamentals', label: 'LiDAR fundamentals and scanner simulation' },
  { id: 'placement', label: 'Sensor selection and placement' },
  { id: 'processing', label: 'Point cloud processing' },
  { id: 'registration', label: 'Registration and SLAM' },
  { id: 'fusion', label: 'LiDAR and camera fusion' },
  { id: 'clustering', label: 'Clustering and segmentation' },
  { id: 'supervised', label: 'Supervised learning and AI' },
  { id: 'scene', label: 'Scene graphs and spatial reasoning' },
  { id: 'change', label: 'Change detection' },
  { id: 'surfaces', label: 'Meshing, surfaces and scan to CAD' },
  { id: 'challenge', label: 'Final industrial challenge' },
  { id: 'other', label: 'Other' },
];
export const MAX_TEXT = 1000;

export type Rating = 1 | 2 | 3 | 4 | 5;
export interface FormState { before: (Rating | null)[]; after: (Rating | null)[]; helpful: Rating | null; module: string; text: string }
/** Nothing is pre-selected: every rating starts unanswered. */
export const emptyForm = (): FormState => ({ before: [null, null, null], after: [null, null, null], helpful: null, module: '', text: '' });

/** The questions still unanswered, in the order they are asked. Equal and lower After ratings are fine: only blanks count. */
export function missing(f: FormState): string[] {
  const out: string[] = [];
  TOPICS.forEach((_, i) => { if (f.before[i] === null) out.push(`before-${i}`); if (f.after[i] === null) out.push(`after-${i}`); });
  if (f.helpful === null) out.push('helpful');
  if (!MODULES.some((m) => m.id === f.module)) out.push('module');
  return out;
}
export const labelOf = (key: string): string => {
  const m = /^(before|after)-(\d)$/.exec(key);
  return m ? `${m[1] === 'before' ? 'Before' : 'After'}: ${TOPICS[Number(m[2])].label}` : key === 'helpful' ? 'How helpful the simulations were' : key === 'module' ? 'The most useful part of the lab' : key;
};

/** A short name for an unanswered question, for the list of what is still missing ("Question 3 · After"). */
export const shortLabel = (key: string): string => {
  const m = /^(before|after)-(\d)$/.exec(key);
  return m ? `Question ${Number(m[2]) + 1} · ${m[1] === 'before' ? 'Before' : 'After'}` : key === 'helpful' ? 'Question 4 · Helpfulness' : key === 'module' ? 'Question 5 · Most useful part' : key;
};

export interface Payload { sid: string; before: number[]; after: number[]; helpful: number; module: string; text: string; version?: string }
export const toPayload = (f: FormState, sid: string, version = ''): Payload | null => (missing(f).length ? null : { sid, before: f.before as number[], after: f.after as number[], helpful: f.helpful as number, module: f.module, text: f.text.trim().slice(0, MAX_TEXT), ...(version ? { version } : {}) });

/** One id per filled-in form, made once and kept until it is sent: a double click or a retry then reaches the server as the same response. */
export function newSid(): string {
  const a = new Uint8Array(12); try { crypto.getRandomValues(a); } catch { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return 'fb-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** After minus before for one topic, as text ("+2", "0", "−1"). */
export const changeText = (b: Rating | null, a: Rating | null): string => (b === null || a === null ? '' : a === b ? 'no change' : a > b ? `+${a - b}` : `−${b - a}`);
