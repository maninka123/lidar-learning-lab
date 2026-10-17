import { SceneDef, Primitive, box, cyl, sph, place, finalize } from './geometry';

const car = (x: number, y: number, yaw: number): Primitive[] =>
  place([
    box([0, 0, 0.6], [4.2, 1.8, 0.75]),
    box([-0.2, 0, 1.3], [2.3, 1.6, 0.65], 0, { mat: { color: [40, 50, 60], reflectivity: 0.12 } }),
    ...[[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]].map(([px, py]) => cyl([px, py, 0.32], 0.32, 0.25, 'y', { mat: { color: [25, 25, 25], reflectivity: 0.08 } })),
  ], x, y, 0, yaw);

const building = (x0: number, x1: number, yFront: number, depth: number, h: number, dir: 1 | -1): Primitive[] => {
  const cx = (x0 + x1) / 2, w = x1 - x0;
  const parts: Primitive[] = [box([cx, yFront + (dir * depth) / 2, h / 2], [w, depth, h])];
  const cols = Math.floor(w / 2.6);
  for (let i = 0; i < cols; i++)
    for (let z = 2.2; z < h - 1; z += 3)
      parts.push(box([x0 + (i + 0.5) * (w / cols), yFront - dir * 0.04, z], [1.2, 0.08, 1.4], 0, { mat: { color: [60, 90, 120], reflectivity: 0.1 } }));
  return parts;
};

export function buildOutdoor(): SceneDef {
  const trees = [-10, -2, 6, 12].map((x, i) => ({
    id: `tree-${i + 1}`, name: `Tree ${i + 1}`, classId: 16, color: [70, 150, 70] as [number, number, number], reflectivity: 0.5,
    parts: [cyl([x, 5.5, 1.4], 0.15, 2.5, 'z', { mat: { color: [95, 70, 50], reflectivity: 0.3 } }), sph([x, 5.5, 4.0], 1.4, { porous: 0.45 })],
    description: 'Foliage is porous: a ray may produce multiple returns.',
  }));
  const poles = [-6, 5].map((x, i) => ({
    id: `pole-${i + 1}`, name: `Lamp post ${i + 1}`, classId: 18, color: [90, 90, 96] as [number, number, number], reflectivity: 0.4,
    parts: [cyl([x, -4.6, 3.1], 0.08, 6, 'z'), box([x, -4.1, 6.05], [0.1, 1.1, 0.1])],
  }));
  const objs = [
    { id: 'road', name: 'Road', classId: 13, structural: true, color: [70, 74, 80], reflectivity: 0.15, pattern: 'stripes', parts: [box([0, 0, -0.1], [30, 7, 0.2])] },
    { id: 'pavement-s', name: 'South pavement', classId: 14, structural: true, color: [170, 172, 174], reflectivity: 0.4, pattern: 'checker', parts: [box([0, -4.75, 0.025], [30, 2.5, 0.25])] },
    { id: 'pavement-n', name: 'North pavement', classId: 14, structural: true, color: [170, 172, 174], reflectivity: 0.4, pattern: 'checker', parts: [box([0, 4.75, 0.025], [30, 2.5, 0.25])] },
    { id: 'building-1', name: 'Building 1 (façade)', classId: 17, color: [200, 180, 165], reflectivity: 0.55, parts: building(-15, -5, 6, 6, 9, 1) },
    { id: 'building-2', name: 'Building 2 (façade)', classId: 17, color: [175, 185, 195], reflectivity: 0.55, parts: building(-4.5, 4, 6, 6, 12, 1) },
    { id: 'building-3', name: 'Building 3 (façade)', classId: 17, color: [210, 195, 175], reflectivity: 0.55, parts: building(4.5, 15, 6, 6, 8, 1) },
    { id: 'building-4', name: 'Building 4 (façade)', classId: 17, color: [190, 175, 170], reflectivity: 0.55, parts: building(-15, 15, -6, 6, 7, -1) },
    { id: 'car-1', name: 'Car 1', classId: 15, color: [200, 50, 50], reflectivity: 0.5, parts: car(-8, -2, 0) },
    { id: 'car-2', name: 'Car 2', classId: 15, color: [60, 90, 190], reflectivity: 0.5, parts: car(2, -2.1, 0.03) },
    { id: 'car-3', name: 'Car 3', classId: 15, color: [230, 230, 230], reflectivity: 0.7, parts: car(9, 2.1, Math.PI) },
    ...trees,
    ...poles,
    { id: 'bollard', name: 'Bollard (in pedestrian path)', classId: 19, color: [240, 120, 60], reflectivity: 0.5, parts: [cyl([0, 4.4, 0.6], 0.15, 0.9, 'z')], description: 'Obstacle in the pedestrian corridor.' },
    { id: 'sky-backdrop', name: 'Distant hills (visual only)', classId: 0, scannable: false, color: [130, 170, 150], reflectivity: 0.2, parts: [box([0, 40, 5], [90, 0.5, 14])], description: 'Visual-only backdrop.' },
  ];
  return {
    id: 'C',
    name: 'Scene C · Outdoor street',
    description: 'Short street with road, pavements, parked vehicles, trees (porous foliage), lamp posts and building façades.',
    objects: finalize(objs as never),
    bounds: { min: [-15, -6, 0], max: [15, 6, 12] },
    corridor: { start: [-12, 4.4], end: [12, 4.4], width: 1.4, height: 2.2 },
    defaultPose: { x: 0, y: -0.2, z: 1.8, yaw: 0 },
    targetObjectId: 'bollard',
    cameraHome: [20, -22, 16],
    cameraTarget: [0, 0, 2],
  };
}
