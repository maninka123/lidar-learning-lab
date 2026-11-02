import { SceneDef, SceneObject, box, cyl, place, finalize, objectAABB, Primitive } from '../scenes/geometry';
import { makeRng } from '../core/rng';
import { Vec3 } from '../core/math';

/** The industrial environment of the challenge, built from the same geometry the rest of the lab uses.
 *  Everything that the grader knows (what each object is, where it is, what colour its label is, what changed) lives here
 *  and is never handed to the student's pipeline. */

export type TwinClass = 'pallet' | 'box' | 'drum' | 'container' | 'rack' | 'machine' | 'conveyor' | 'forklift' | 'small' | 'obstacle';
export const TWIN_CLASSES: TwinClass[] = ['pallet', 'box', 'drum', 'container', 'rack', 'machine', 'conveyor', 'forklift', 'small', 'obstacle'];
export const TWIN_CLASS_ID: Record<TwinClass, number> = { pallet: 101, box: 102, drum: 103, container: 104, rack: 105, machine: 106, conveyor: 107, forklift: 108, small: 109, obstacle: 110 };
export const STRUCT_CLASS_ID = { floor: 120, wall: 121, ceiling: 122, pillar: 123, partition: 124, pipe: 125, bench: 126 };
export type ZoneId = 'storage' | 'production' | 'inspection' | 'loading' | 'lowlight';
export type LabelColour = 'red' | 'green' | 'yellow' | 'none';
export const LABEL_RGB: Record<Exclude<LabelColour, 'none'>, [number, number, number]> = { red: [205, 40, 40], green: [40, 165, 70], yellow: [235, 205, 40] };

export const ZONES: { id: ZoneId; name: string; min: [number, number]; max: [number, number]; light: number }[] = [
  { id: 'storage', name: 'Storage', min: [-12, -8], max: [-4, 1], light: 0.85 },
  { id: 'inspection', name: 'Inspection', min: [-4, -8], max: [3, 1], light: 0.85 },
  { id: 'loading', name: 'Loading', min: [3, -8], max: [12, 1], light: 0.8 },
  { id: 'production', name: 'Production', min: [-12, 1], max: [2, 8], light: 0.9 },
  { id: 'lowlight', name: 'Low light', min: [2, 1], max: [12, 8], light: 0.07 },
];
export const zoneAt = (x: number, y: number): ZoneId => ZONES.find((z) => x >= z.min[0] && x < z.max[0] && y >= z.min[1] && y < z.max[1])?.id ?? 'production';

export interface SafetyZone { id: string; name: string; min: [number, number]; max: [number, number]; zMin: number; zMax: number }
export const SAFETY_ZONES: SafetyZone[] = [
  { id: 'forklift-route', name: 'Forklift route', min: [-11.5, -1.0], max: [11.5, 0.4], zMin: 0.1, zMax: 2.4 },
  { id: 'emergency-path', name: 'Emergency exit path', min: [10.4, -7.8], max: [11.9, 0.8], zMin: 0.1, zMax: 2.4 },
  { id: 'machine-clearance', name: 'Machine clearance', min: [-3.7, 3.4], max: [-1.3, 4.7], zMin: 0.1, zMax: 2.4 },
];

export interface Target { id: string; cls: TwinClass; zone: ZoneId; instanceId: number; min: Vec3; max: Vec3; centre: Vec3; label: LabelColour; small: boolean }
export interface ChangeTruth { kind: 'added' | 'removed' | 'moved'; id: string; cls: TwinClass; centre: Vec3; from?: Vec3 }
export interface Factory { scene: SceneDef; targets: Target[]; seed: number; epoch: 'A' | 'B'; changes: ChangeTruth[] }

type Def = Omit<SceneObject, 'instanceId' | 'scannable'>;
interface Item { id: string; cls: TwinClass; x: number; y: number; yaw: number; label?: LabelColour; small?: boolean; build: (label: LabelColour) => { parts: Primitive[]; color: [number, number, number]; refl?: number } }

const pallet = (h: number, color: [number, number, number] = [196, 150, 90]) => () => ({
  parts: [box([0, 0, 0.07], [1.2, 0.8, 0.14], 0, { mat: { color: [150, 110, 60], reflectivity: 0.4 } }), box([0, 0, 0.14 + (h - 0.14) / 2], [1.1, 0.74, h - 0.14])], color, refl: 0.5,
});
const crate = (sx: number, sy: number, sz: number, color: [number, number, number]) => () => ({ parts: [box([0, 0, sz / 2], [sx, sy, sz])], color, refl: 0.55 });
const drum = (color: [number, number, number]) => () => ({ parts: [cyl([0, 0, 0.45], 0.3, 0.9, 'z')], color, refl: 0.6 });
const container = (label: LabelColour) => ({
  parts: [
    box([0, 0, 0.55], [0.55, 0.55, 1.1]),
    ...(label !== 'none' ? [box([0, 0.285, 0.75], [0.3, 0.03, 0.3], 0, { mat: { color: LABEL_RGB[label], reflectivity: 0.6 } })] : [box([0, 0.285, 0.75], [0.3, 0.03, 0.3], 0, { mat: { color: [150, 150, 150], reflectivity: 0.6 } })]),
  ], color: [178, 172, 160] as [number, number, number], refl: 0.5,
});
const rack = () => ({
  parts: [
    ...[[-1, -0.3], [1, -0.3], [-1, 0.3], [1, 0.3]].map(([sx, sy]) => box([sx * 1.1, sy, 1.1], [0.06, 0.06, 2.2])),
    ...[0.25, 0.9, 1.55].map((z) => box([0, 0, z], [2.3, 0.7, 0.04])),
  ], color: [60, 150, 140] as [number, number, number], refl: 0.5,
});

const ITEMS: Item[] = [
  // storage
  { id: 'pallet-s1', cls: 'pallet', x: -10.5, y: -6.5, yaw: 0, build: pallet(1.3) }, { id: 'pallet-s2', cls: 'pallet', x: -10.5, y: -4.2, yaw: 0, build: pallet(0.9) },
  { id: 'pallet-s3', cls: 'pallet', x: -8.2, y: -6.5, yaw: 0, build: pallet(1.1) }, { id: 'pallet-s4', cls: 'pallet', x: -8.2, y: -4.2, yaw: 0.1, build: pallet(1.4) },
  { id: 'box-s1', cls: 'box', x: -6.0, y: -6.8, yaw: 0, build: crate(0.8, 0.6, 0.6, [170, 125, 80]) }, { id: 'box-s2', cls: 'box', x: -6.0, y: -5.6, yaw: 0, build: crate(0.5, 0.5, 0.5, [160, 120, 80]) },
  { id: 'box-s3', cls: 'box', x: -5.1, y: -6.8, yaw: 0.3, build: crate(0.4, 0.4, 0.4, [165, 120, 85]) }, { id: 'box-s4', cls: 'box', x: -11.4, y: -3.4, yaw: 0, build: crate(0.7, 0.7, 0.7, [150, 115, 75]) },
  { id: 'box-stray', cls: 'box', x: -9.0, y: -0.4, yaw: 0.2, build: crate(0.5, 0.5, 0.5, [175, 130, 85]) },
  { id: 'drum-s1', cls: 'drum', x: -5.2, y: -3.4, yaw: 0, build: drum([70, 110, 170]) }, { id: 'drum-s2', cls: 'drum', x: -4.6, y: -3.4, yaw: 0, build: drum([70, 110, 170]) }, { id: 'drum-s3', cls: 'drum', x: -4.9, y: -2.7, yaw: 0, build: drum([70, 110, 170]) },
  { id: 'rack-s1', cls: 'rack', x: -10.0, y: -2.2, yaw: 0, build: rack }, { id: 'rack-s2', cls: 'rack', x: -7.4, y: -2.2, yaw: 0, build: rack },
  // inspection: identical containers, only the label differs
  ...[-3.2, -2.0, -0.8, 0.4, 1.6, 2.8].map((x, i): Item => ({ id: `container-i${i + 1}`, cls: 'container', x, y: -6.8, yaw: 0, label: 'none', build: container })),
  { id: 'small-i1', cls: 'small', x: -2.0, y: -3.6, yaw: 0, small: true, build: () => ({ parts: [box([0, 0, 0.875], [0.15, 0.15, 0.15])], color: [200, 80, 60], refl: 0.6 }) },
  { id: 'small-i2', cls: 'small', x: -1.5, y: -3.4, yaw: 0, small: true, build: () => ({ parts: [cyl([0, 0, 0.9], 0.06, 0.2, 'z')], color: [80, 120, 200], refl: 0.6 }) },
  { id: 'small-i3', cls: 'small', x: -1.0, y: -3.6, yaw: 0.4, small: true, build: () => ({ parts: [box([0, 0, 0.85], [0.2, 0.1, 0.1])], color: [90, 170, 90], refl: 0.6 }) },
  { id: 'small-i4', cls: 'small', x: -0.6, y: -3.4, yaw: 0, small: true, build: () => ({ parts: [box([0, 0, 0.86], [0.12, 0.12, 0.12])], color: [220, 180, 60], refl: 0.6 }) },
  // loading
  { id: 'forklift', cls: 'forklift', x: 6.6, y: -5.6, yaw: 0.4, build: () => ({ parts: [box([0, 0, 0.6], [2.2, 1.1, 0.9]), box([0.2, 0, 1.55], [1.0, 1.0, 1.0]), box([1.25, 0, 1.2], [0.15, 0.9, 2.3]), ...[[-0.7, 0.6], [-0.7, -0.6], [0.8, 0.6], [0.8, -0.6]].map(([x, y]) => cyl([x, y, 0.35], 0.35, 0.25, 'y'))], color: [235, 185, 40], refl: 0.5 }) },
  { id: 'pallet-l1', cls: 'pallet', x: 5.0, y: -3.0, yaw: 0, build: pallet(1.2) }, { id: 'pallet-l2', cls: 'pallet', x: 9.2, y: -3.0, yaw: 0.2, build: pallet(1.0) },
  { id: 'pallet-l3', cls: 'pallet', x: 9.4, y: -6.2, yaw: 0, build: pallet(1.3) }, { id: 'pallet-l4', cls: 'pallet', x: 5.0, y: -7.0, yaw: 0, build: pallet(0.8) },
  { id: 'box-l1', cls: 'box', x: 7.4, y: -2.2, yaw: 0, build: crate(0.9, 0.7, 0.7, [165, 125, 80]) },
  // production
  { id: 'machine-p1', cls: 'machine', x: -8.0, y: 5.0, yaw: 0, build: () => ({ parts: [box([0, 0, 0.9], [3.0, 2.0, 1.8]), box([0, 0, 2.0], [1.4, 1.4, 0.6]), cyl([1.0, 0, 2.4], 0.3, 0.6, 'z')], color: [60, 120, 190], refl: 0.45 }) },
  { id: 'machine-p2', cls: 'machine', x: -2.5, y: 5.5, yaw: 0, build: () => ({ parts: [box([0, 0, 0.9], [2.4, 1.6, 1.8])], color: [210, 120, 50], refl: 0.45 }) },
  { id: 'conveyor', cls: 'conveyor', x: -6.5, y: 2.7, yaw: 0, build: () => ({ parts: [box([0, 0, 0.75], [6.0, 0.8, 0.12]), ...[-2.6, -0.9, 0.9, 2.6].flatMap((x) => [box([x, 0.3, 0.37], [0.08, 0.08, 0.74]), box([x, -0.3, 0.37], [0.08, 0.08, 0.74])])], color: [120, 125, 130], refl: 0.5 }) },
  { id: 'small-p1', cls: 'small', x: -4.0, y: 3.9, yaw: 0, small: true, build: () => ({ parts: [cyl([0, 0, 0.125], 0.09, 0.25, 'z')], color: [200, 60, 60], refl: 0.6 }) },
  { id: 'small-p2', cls: 'small', x: -0.6, y: 2.4, yaw: 0.3, small: true, build: () => ({ parts: [box([0, 0, 0.15], [0.2, 0.2, 0.3])], color: [90, 90, 100], refl: 0.5 }) },
  { id: 'small-p3', cls: 'small', x: -10.9, y: 6.2, yaw: 0, small: true, build: () => ({ parts: [box([0, 0, 0.1], [0.3, 0.2, 0.2])], color: [80, 80, 90], refl: 0.5 }) },
  // low light
  ...[4.5, 5.7, 6.9, 8.1].map((x, i): Item => ({ id: `container-d${i + 1}`, cls: 'container', x, y: 7.0, yaw: Math.PI, label: 'none', build: container })),
  { id: 'rack-d1', cls: 'rack', x: 4.0, y: 3.0, yaw: 0, build: rack }, { id: 'box-d1', cls: 'box', x: 10.5, y: 3.0, yaw: 0, build: crate(0.8, 0.8, 0.8, [160, 120, 80]) },
  { id: 'machine-d1', cls: 'machine', x: 10.0, y: 5.6, yaw: 0, build: () => ({ parts: [box([0, 0, 0.8], [2.0, 1.4, 1.6])], color: [90, 170, 110], refl: 0.45 }) },
];

/** What happens between the two surveys. Which of these happen is picked by the scenario seed. */
interface Move { id: string; to: [number, number]; yaw?: number }
const MOVE_CANDIDATES: Move[] = [
  { id: 'pallet-s3', to: [-10.5, -7.4] }, { id: 'pallet-s4', to: [-6.8, -4.6] }, { id: 'pallet-l1', to: [3.9, -5.4], yaw: 0.6 },
  { id: 'pallet-l4', to: [8.5, -7.2] }, { id: 'box-s1', to: [-3.6, -3.0] }, { id: 'box-s4', to: [-8.8, -7.6] },
];
const REMOVE_CANDIDATES = ['container-i2', 'container-i5', 'drum-s2', 'box-s3', 'container-d2'];
const ADD_SLOTS: (Item & { always?: boolean })[] = [
  { id: 'cone-new', cls: 'obstacle', x: -1.0, y: -0.2, yaw: 0, always: true, build: () => ({ parts: [cyl([0, 0, 0.3], 0.25, 0.6, 'z')], color: [255, 110, 30], refl: 0.6 }) },
  { id: 'pallet-new', cls: 'pallet', x: 11.0, y: -4.5, yaw: 0, always: true, build: pallet(1.0) },
  { id: 'cabinet-new', cls: 'machine', x: -2.5, y: 3.9, yaw: 0, build: () => ({ parts: [box([0, 0, 0.8], [1.0, 0.8, 1.6])], color: [140, 140, 150], refl: 0.5 }) },
  { id: 'pallet-new2', cls: 'pallet', x: 9.2, y: -1.9, yaw: 0, build: pallet(1.2) },
];
const SMALL_SHIFT = { id: 'small-i3', dx: 0.5, dy: 0.0 };

const WALL: [number, number, number] = [185, 190, 192];
const structure = (): Def[] => [
  { id: 'floor', name: 'Concrete floor', classId: STRUCT_CLASS_ID.floor, structural: true, color: [128, 130, 132], reflectivity: 0.3, pattern: 'checker', parts: [box([0, 0, -0.05], [24.4, 16.4, 0.1])] },
  { id: 'ceiling', name: 'Roof deck', classId: STRUCT_CLASS_ID.ceiling, structural: true, hideFlag: 'ceiling', color: [210, 210, 210], reflectivity: 0.5, parts: [box([0, 0, 6.05], [24.4, 16.4, 0.1])] },
  { id: 'wall-n', name: 'North wall', classId: STRUCT_CLASS_ID.wall, structural: true, color: WALL, reflectivity: 0.6, parts: [box([0, 8.1, 3], [24.4, 0.2, 6])] },
  { id: 'wall-s', name: 'South wall', classId: STRUCT_CLASS_ID.wall, structural: true, color: WALL, reflectivity: 0.6, parts: [box([0, -8.1, 3], [24.4, 0.2, 6])] },
  { id: 'wall-w', name: 'West wall', classId: STRUCT_CLASS_ID.wall, structural: true, color: WALL, reflectivity: 0.6, parts: [box([-12.1, 0, 3], [0.2, 16, 6])] },
  { id: 'wall-e', name: 'East wall', classId: STRUCT_CLASS_ID.wall, structural: true, color: WALL, reflectivity: 0.6, parts: [box([12.1, 0, 3], [0.2, 16, 6])] },
  { id: 'partition', name: 'Partition wall (door gap between)', classId: STRUCT_CLASS_ID.partition, structural: true, color: [200, 200, 196], reflectivity: 0.6, parts: [box([2, 2.25, 1.5], [0.2, 2.5, 3]), box([2, 6.75, 1.5], [0.2, 2.5, 3])] },
  ...[[-3.9, 7.6], [3.9, 7.6], [-3.9, -7.6], [3.9, -7.6]].map(([x, y], i): Def => ({ id: `pillar-${i + 1}`, name: `Pillar ${i + 1}`, classId: STRUCT_CLASS_ID.pillar, color: [160, 160, 168], reflectivity: 0.5, parts: [box([x, y, 3], [0.5, 0.5, 6])] })),
  { id: 'pipes', name: 'Overhead pipes', classId: STRUCT_CLASS_ID.pipe, color: [230, 200, 60], reflectivity: 0.55, parts: [cyl([-4, 4, 4.6], 0.15, 16, 'x'), cyl([-1.2, 7.4, 2.3], 0.12, 4.6, 'z'), cyl([6, 5, 4.2], 0.12, 6, 'x')] },
  { id: 'workbench', name: 'Workbench', classId: STRUCT_CLASS_ID.bench, color: [110, 90, 70], reflectivity: 0.4, parts: [box([-1.3, -3.5, 0.4], [2.2, 0.9, 0.8])] },
];

const mk = (it: Item, x: number, y: number, yaw: number, label: LabelColour): Def => {
  const b = it.build(label), parts = place(b.parts, x, y, 0, yaw);
  return { id: it.id, name: it.id, classId: TWIN_CLASS_ID[it.cls], color: b.color, reflectivity: b.refl ?? 0.5, parts };
};

/** Build the factory for one scenario seed and survey time. The seed shifts positions a little, shuffles the label colours and picks what changes between A and B. */
export function buildFactory(seed: number, epoch: 'A' | 'B'): Factory {
  const rng = makeRng(seed * 7919 + 13), rngChange = makeRng(seed * 104729 + 7);
  const jit = new Map<string, [number, number, number]>();
  for (const it of ITEMS) jit.set(it.id, [rng.range(-0.12, 0.12), rng.range(-0.12, 0.12), rng.range(-0.1, 0.1)]);
  // label colours: each of the six inspection and four low-light containers gets red, green or yellow (shuffled by seed)
  const pool: LabelColour[] = ['red', 'green', 'yellow', 'red', 'green', 'yellow', 'red', 'green', 'yellow', 'red'];
  for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const labelOf = new Map<string, LabelColour>(); let li = 0;
  for (const it of ITEMS) if (it.label !== undefined) labelOf.set(it.id, pool[li++]);

  const pos = new Map<string, { x: number; y: number; yaw: number }>();
  for (const it of ITEMS) { const j = jit.get(it.id)!; pos.set(it.id, { x: it.x + j[0], y: it.y + j[1], yaw: it.yaw + j[2] }); }

  const changes: ChangeTruth[] = [];
  const removed = new Set<string>(), added: Item[] = [];
  if (epoch === 'B') {
    const movePool = [...MOVE_CANDIDATES]; for (let i = movePool.length - 1; i > 0; i--) { const j = rngChange.int(i + 1); [movePool[i], movePool[j]] = [movePool[j], movePool[i]]; }
    for (const m of movePool.slice(0, 3)) { const p = pos.get(m.id)!, it = ITEMS.find((q) => q.id === m.id)!; changes.push({ kind: 'moved', id: m.id, cls: it.cls, centre: [m.to[0], m.to[1], 0], from: [p.x, p.y, 0] }); pos.set(m.id, { x: m.to[0], y: m.to[1], yaw: m.yaw ?? p.yaw }); }
    const remPool = [...REMOVE_CANDIDATES]; for (let i = remPool.length - 1; i > 0; i--) { const j = rngChange.int(i + 1); [remPool[i], remPool[j]] = [remPool[j], remPool[i]]; }
    for (const id of remPool.slice(0, 2)) { const p = pos.get(id)!, it = ITEMS.find((q) => q.id === id)!; removed.add(id); changes.push({ kind: 'removed', id, cls: it.cls, centre: [p.x, p.y, 0] }); }
    const optional = rngChange.next() < 0.5 ? 'cabinet-new' : 'pallet-new2';
    for (const a of ADD_SLOTS) if (a.always || a.id === optional) { added.push(a); changes.push({ kind: 'added', id: a.id, cls: a.cls, centre: [a.x, a.y, 0] }); }
    const s = pos.get(SMALL_SHIFT.id)!; changes.push({ kind: 'moved', id: SMALL_SHIFT.id, cls: 'small', centre: [s.x + SMALL_SHIFT.dx, s.y + SMALL_SHIFT.dy, 0], from: [s.x, s.y, 0] });
    pos.set(SMALL_SHIFT.id, { ...s, x: s.x + SMALL_SHIFT.dx, y: s.y + SMALL_SHIFT.dy });
  }

  const defs: Def[] = structure();
  const itemOf = new Map<string, Item>();
  for (const it of ITEMS) { if (removed.has(it.id)) continue; const p = pos.get(it.id)!; defs.push(mk(it, p.x, p.y, p.yaw, labelOf.get(it.id) ?? 'none')); itemOf.set(it.id, it); }
  for (const a of added) { defs.push(mk(a, a.x, a.y, a.yaw, 'none')); itemOf.set(a.id, a); }

  const objects = finalize(defs as never);
  const targets: Target[] = [];
  for (const o of objects) {
    const it = itemOf.get(o.id); if (!it) continue;
    const bb = objectAABB(o), c: Vec3 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
    targets.push({ id: o.id, cls: it.cls, zone: zoneAt(c[0], c[1]), instanceId: o.instanceId, min: bb.min, max: bb.max, centre: c, label: it.cls === 'container' ? labelOf.get(o.id) ?? 'none' : 'none', small: !!it.small });
  }
  const scene: SceneDef = {
    id: 'F', name: 'Industrial factory', description: '24 m × 16 m factory: storage, production, inspection, loading and a poorly lit zone.',
    objects, bounds: { min: [-12, -8, 0], max: [12, 8, 6] }, defaultPose: { x: 0, y: -0.3, z: 1.6, yaw: 0 }, cameraHome: [22, -24, 16], cameraTarget: [0, 0, 1.5],
  };
  return { scene, targets, seed, epoch, changes };
}

/** Illumination (0..1) at a world position: the zone's lamps plus any extra lighting units the team bought. */
export function illuminationAt(x: number, y: number, z: number, lights: { x: number; y: number; z: number; power: number }[] = []): number {
  // the outer walls stand a little outside the zone rectangles: they belong to the zone they bound
  const zx = Math.min(11.999, Math.max(-12, x)), zy = Math.min(7.999, Math.max(-8, y));
  const zone = ZONES.find((q) => zx >= q.min[0] && zx < q.max[0] && zy >= q.min[1] && zy < q.max[1]) ?? ZONES[3];
  let e = zone.light;
  for (const l of lights) { const d2 = (x - l.x) ** 2 + (y - l.y) ** 2 + (z - l.z) ** 2; e += l.power / (1 + d2 / 9); }
  return Math.min(1.2, e);
}

export const isSmallObject = (t: Target) => t.small;
export type { SceneObject };

/** Exact distance from a world point to the nearest surface of the scannable geometry (boxes, cylinders, spheres). Used by the grader. */
export function distToSurface(scene: SceneDef, x: number, y: number, z: number, cap = 1): number {
  let best = cap;
  for (const o of scene.objects) {
    if (!o.scannable) continue;
    for (const p of o.parts) {
      const rx = x - p.c[0], ry = y - p.c[1], rz = z - p.c[2];
      if (Math.abs(rx) > best + 12 && Math.abs(ry) > best + 12) continue;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = c * rx + s * ry, ly = -s * rx + c * ry;
      let d: number;
      if (p.kind === 'box') {
        const qx = Math.abs(lx) - p.size![0] / 2, qy = Math.abs(ly) - p.size![1] / 2, qz = Math.abs(rz) - p.size![2] / 2;
        const m = Math.max(qx, qy, qz);
        d = m < 0 ? -m : Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      } else if (p.kind === 'sphere') d = Math.abs(Math.hypot(lx, ly, rz) - p.r!);
      else {
        const [a, b, w] = p.axis === 'x' ? [ly, rz, lx] : p.axis === 'y' ? [rz, lx, ly] : [lx, ly, rz];
        const dr = Math.hypot(a, b) - p.r!, dw = Math.abs(w) - p.h! / 2;
        d = dr > 0 || dw > 0 ? Math.hypot(Math.max(dr, 0), Math.max(dw, 0)) : -Math.max(dr, dw);
      }
      if (d < best) best = d;
    }
  }
  return best;
}
