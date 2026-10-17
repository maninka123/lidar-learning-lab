import { SceneDef, SceneObject, Primitive, box, cyl, sph, place, finalize } from './geometry';

const chairParts = (): Primitive[] => [
  box([0, 0, 0.45], [0.45, 0.45, 0.05]),
  box([0, -0.2, 0.72], [0.45, 0.05, 0.5]),
  ...[[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].map(([x, y]) => box([x, y, 0.215], [0.04, 0.04, 0.43])),
];
const tableParts = (w: number, d: number): Primitive[] => [
  box([0, 0, 0.725], [w, d, 0.05]),
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => box([sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), 0.35], [0.06, 0.06, 0.7])),
];

export function chair(id: string, x: number, y: number, yaw: number, color: [number, number, number] = [66, 140, 220]) {
  return { id, name: id.replace('-', ' '), classId: 5, parts: place(chairParts(), x, y, 0, yaw), color, reflectivity: 0.45 };
}
export function table(id: string, x: number, y: number, w: number, d: number, yaw = 0) {
  return { id, name: id.replace('-', ' '), classId: 4, parts: place(tableParts(w, d), x, y, 0, yaw), color: [196, 140, 80] as [number, number, number], reflectivity: 0.5 };
}
export function crate(id: string, x: number, y: number, sx: number, sy: number, sz: number, yaw = 0, color: [number, number, number] = [214, 90, 80], classId = 6) {
  return { id, name: id.replace('-', ' '), classId, parts: [box([x, y, sz / 2], [sx, sy, sz], yaw)], color, reflectivity: 0.55 };
}

export function buildRoom(): SceneDef {
  const wallC: [number, number, number] = [214, 214, 208];
  const objs: Omit<SceneObject, 'instanceId' | 'scannable'>[] = [
    { id: 'floor', name: 'Floor', classId: 1, structural: true, color: [158, 146, 128], reflectivity: 0.35, pattern: 'checker', parts: [box([0, 0, -0.05], [8.4, 6.4, 0.1])] },
    { id: 'ceiling', name: 'Ceiling', classId: 3, structural: true, hideFlag: 'ceiling', color: [235, 235, 232], reflectivity: 0.7, parts: [box([0, 0, 3.05], [8.4, 6.4, 0.1])] },
    { id: 'wall-north', name: 'North wall', classId: 2, structural: true, color: wallC, reflectivity: 0.65, parts: [box([0, 3.1, 1.5], [8.4, 0.2, 3])] },
    { id: 'wall-west', name: 'West wall', classId: 2, structural: true, color: wallC, reflectivity: 0.65, parts: [box([-4.1, 0, 1.5], [0.2, 6, 3])] },
    { id: 'wall-east', name: 'East wall', classId: 2, structural: true, color: wallC, reflectivity: 0.65, parts: [box([4.1, 0, 1.5], [0.2, 6, 3])] },
    {
      id: 'wall-south', name: 'South wall (door opening)', classId: 2, structural: true, color: wallC, reflectivity: 0.65,
      parts: [box([-1.1, -3.1, 1.5], [6.2, 0.2, 3]), box([3.6, -3.1, 1.5], [1.2, 0.2, 3]), box([2.5, -3.1, 2.55], [1.0, 0.2, 0.9])],
    },
    {
      id: 'door-frame', name: 'Door frame', classId: 7, color: [120, 92, 74], reflectivity: 0.4,
      parts: [box([1.97, -3.1, 1.05], [0.06, 0.24, 2.1]), box([3.03, -3.1, 1.05], [0.06, 0.24, 2.1]), box([2.5, -3.1, 2.13], [1.12, 0.24, 0.06])],
    },
    table('table-1', -1.5, 1.0, 1.6, 0.8),
    table('table-2', 0.9, -1.2, 1.2, 0.8),
    chair('chair-1', -1.5, 1.85, Math.PI),
    chair('chair-2', -1.5, 0.15, 0),
    chair('chair-3', 0.9, -0.35, Math.PI, [220, 90, 90]),
    chair('chair-4', 0.9, -2.05, 0, [220, 90, 90]),
    crate('box-1', -3.3, -2.4, 0.6, 0.6, 0.6, 0.3),
    crate('box-2', -3.3, 2.3, 0.5, 0.4, 0.9, 0, [200, 160, 70]),
    crate('box-3', 3.4, 2.3, 0.4, 0.4, 0.4, 0.5, [90, 170, 120]),
    { ...crate('calibration-cube', 0.0, 2.4, 0.3, 0.3, 0.3, 0, [250, 250, 250]), name: 'Calibration cube (0.3 m)', reflectivity: 0.9, classId: 20 },
    { ...crate('box-corridor', 2.4, 1.0, 0.6, 0.5, 0.5, 0.2, [230, 120, 60]), name: 'Box in corridor', description: 'Placed in the walking corridor on purpose.' },
    { id: 'light-panel', name: 'Ceiling light (visual only)', classId: 0, scannable: false, color: [255, 250, 210], reflectivity: 0.9, parts: [box([0, 0, 2.97], [1.2, 0.6, 0.02])], description: 'Visual-only: cannot be scanned.' } as never,
  ];
  return {
    id: 'A',
    name: 'Scene A · Simple room',
    description: '8 m × 6 m × 3 m room with a door opening, two tables, four chairs and boxes. Every object has a known class, dimensions and material.',
    objects: finalize(objs as never),
    bounds: { min: [-4, -3, 0], max: [4, 3, 3] },
    corridor: { start: [2.5, -3.0], end: [2.5, 3.0], width: 1.0, height: 2.0 },
    defaultPose: { x: -0.2, y: 0.2, z: 1.4, yaw: 0 },
    targetObjectId: 'calibration-cube',
    cameraHome: [7.5, -8, 6.5],
    cameraTarget: [0, 0, 1],
  };
}

export { cyl, sph };
