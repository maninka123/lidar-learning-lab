import { SceneDef, box, cyl, place, finalize } from './geometry';
import { crate } from './rooms';

const rack = (x: number, y: number, yaw: number) => {
  const parts = [
    ...[[-1, -0.3], [1, -0.3], [-1, 0.3], [1, 0.3]].map(([sx, sy]) => box([sx * 1.1, sy, 1.1], [0.06, 0.06, 2.2])),
    ...[0.25, 0.9, 1.55].map((z) => box([0, 0, z], [2.3, 0.7, 0.04])),
    box([-0.6, 0, 0.45], [0.5, 0.5, 0.4], 0, { mat: { color: [200, 150, 80], reflectivity: 0.55 } }),
    box([0.5, 0, 1.1], [0.6, 0.5, 0.45], 0, { mat: { color: [90, 150, 200], reflectivity: 0.5 } }),
    box([-0.4, 0, 1.75], [0.4, 0.4, 0.35], 0, { mat: { color: [220, 90, 80], reflectivity: 0.5 } }),
  ];
  return place(parts, x, y, 0, yaw);
};

export function buildIndustrial(): SceneDef {
  const wall: [number, number, number] = [185, 190, 192];
  const objs = [
    { id: 'floor', name: 'Concrete floor', classId: 1, structural: true, color: [128, 130, 132], reflectivity: 0.3, pattern: 'checker', parts: [box([0, 0, -0.05], [14.4, 10.4, 0.1])] },
    { id: 'ceiling', name: 'Roof deck', classId: 3, structural: true, hideFlag: 'ceiling', color: [210, 210, 210], reflectivity: 0.5, parts: [box([0, 0, 5.05], [14.4, 10.4, 0.1])] },
    { id: 'wall-north', name: 'North wall', classId: 2, structural: true, color: wall, reflectivity: 0.6, parts: [box([0, 5.1, 2.5], [14.4, 0.2, 5])] },
    { id: 'wall-south', name: 'South wall', classId: 2, structural: true, color: wall, reflectivity: 0.6, parts: [box([0, -5.1, 2.5], [14.4, 0.2, 5])] },
    { id: 'wall-west', name: 'West wall', classId: 2, structural: true, color: wall, reflectivity: 0.6, parts: [box([-7.1, 0, 2.5], [0.2, 10, 5])] },
    { id: 'wall-east', name: 'East wall', classId: 2, structural: true, color: wall, reflectivity: 0.6, parts: [box([7.1, 0, 2.5], [0.2, 10, 5])] },
    ...[[-4, -2.5], [4, -2.5], [-4, 2.5], [4, 2.5]].map(([x, y], i) => ({
      id: `pillar-${i + 1}`, name: `Pillar ${i + 1}`, classId: 8, color: [160, 160, 168] as [number, number, number], reflectivity: 0.5, parts: [box([x, y, 2.5], [0.5, 0.5, 5])],
    })),
    { id: 'cnc-machine', name: 'CNC machine', classId: 9, color: [60, 120, 190] as [number, number, number], reflectivity: 0.45, parts: [box([-5, -3.4, 0.9], [2.4, 1.5, 1.8]), box([-5, -3.4, 2.0], [1.2, 1.0, 0.4])] },
    { id: 'press', name: 'Hydraulic press', classId: 9, color: [210, 120, 50] as [number, number, number], reflectivity: 0.45, parts: [box([-5, 3.6, 1.1], [1.6, 1.6, 2.2])] },
    { id: 'tank', name: 'Storage tank', classId: 9, color: [200, 205, 210] as [number, number, number], reflectivity: 0.7, parts: [cyl([5, -3.5, 1.2], 0.9, 2.4, 'z')] },
    { id: 'rack-1', name: 'Shelf rack 1', classId: 10, color: [60, 150, 140] as [number, number, number], reflectivity: 0.5, parts: rack(-1.5, 4.5, 0) },
    { id: 'rack-2', name: 'Shelf rack 2', classId: 10, color: [60, 150, 140] as [number, number, number], reflectivity: 0.5, parts: rack(2.0, 4.5, 0) },
    { id: 'pipe-main', name: 'Main pipe', classId: 11, color: [230, 200, 60] as [number, number, number], reflectivity: 0.55, parts: [cyl([0, -4.6, 3.6], 0.14, 13.6, 'x'), cyl([-3, -4.6, 1.8], 0.1, 3.6, 'z'), cyl([3.5, -4.6, 1.8], 0.1, 3.6, 'z')] },
    { id: 'pipe-cross', name: 'Cross pipe', classId: 11, color: [230, 200, 60] as [number, number, number], reflectivity: 0.55, parts: [cyl([6.0, 0, 4.2], 0.12, 9.6, 'y')] },
    { ...crate('pallet-obstacle', 0.5, 0.3, 0.9, 0.9, 0.9, 0.3, [235, 130, 40], 12), name: 'Pallet obstacle (in corridor)', description: 'Obstacle in the designated walking corridor.' },
    { ...crate('crate-1', 5.3, 1.8, 0.7, 0.7, 0.7, 0, [150, 110, 70], 6), name: 'Crate 1' },
    { ...crate('crate-2', -6.0, 0.4, 0.6, 0.9, 0.5, 0.2, [150, 110, 70], 6), name: 'Crate 2' },
    { id: 'safety-line', name: 'Floor marking (visual only)', classId: 0, scannable: false, color: [250, 220, 40] as [number, number, number], reflectivity: 0.8, parts: [box([0, 0, 0.003], [12, 1.4, 0.005])], description: 'Visual-only: painted corridor outline, not scannable.' },
  ];
  return {
    id: 'B',
    name: 'Scene B · Industrial workshop',
    description: '14 m × 10 m × 5 m workshop with pillars, machines, shelving, pipes and a pallet blocking the marked walking corridor.',
    objects: finalize(objs as never),
    bounds: { min: [-7, -5, 0], max: [7, 5, 5] },
    corridor: { start: [-6, 0], end: [6, 0], width: 1.4, height: 2.2 },
    defaultPose: { x: -2.5, y: -1.5, z: 1.6, yaw: 0.3 },
    targetObjectId: 'crate-1',
    cameraHome: [13, -13, 10],
    cameraTarget: [0, 0, 1.5],
  };
}
