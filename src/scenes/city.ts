import { SceneDef, SceneObject, Primitive, box, cyl, sph, place, finalize } from './geometry';

/** Scene D: a small city district built for SLAM. Two long east-west roads, two north-south roads, four crossings,
 *  a school, parked vehicles, pedestrians, trees, lamp posts and traffic lights. Only used by the SLAM & Mobile Scanning tab. */
export const car = (x: number, y: number, yaw: number): Primitive[] =>
  place([
    box([0, 0, 0.6], [4.2, 1.8, 0.75]),
    box([-0.2, 0, 1.3], [2.3, 1.6, 0.65], 0, { mat: { color: glass, reflectivity: 0.12 } }),
    ...[[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]].map(([px, py]) => cyl([px, py, 0.32], 0.32, 0.25, 'y', { mat: { color: [25, 25, 25], reflectivity: 0.08 } })),
  ], x, y, 0, yaw);
export const bus = (x: number, y: number, yaw: number): Primitive[] =>
  place([
    box([0, 0, 1.7], [10, 2.5, 2.6]),
    box([0, 0, 2.2], [9.6, 2.55, 0.8], 0, { mat: { color: glass, reflectivity: 0.12 } }),
    ...[[-3.2, -1.2], [3.2, -1.2], [-3.2, 1.2], [3.2, 1.2]].map(([px, py]) => cyl([px, py, 0.5], 0.5, 0.3, 'y', { mat: { color: [25, 25, 25], reflectivity: 0.08 } })),
  ], x, y, 0, yaw);
const truck = (x: number, y: number, yaw: number): Primitive[] =>
  place([box([-1.5, 0, 1.7], [5, 2.4, 2.8]), box([2.6, 0, 1.2], [2, 2.3, 1.9]), ...[[-3, -1.1], [2.5, -1.1], [-3, 1.1], [2.5, 1.1]].map(([px, py]) => cyl([px, py, 0.5], 0.5, 0.3, 'y', { mat: { color: [25, 25, 25], reflectivity: 0.08 } }))], x, y, 0, yaw);
export const person = (x: number, y: number, z0: number): Primitive[] => [
  cyl([x, y + 0.1, z0 + 0.45], 0.085, 0.9, 'z'), cyl([x, y - 0.1, z0 + 0.45], 0.085, 0.9, 'z'),
  box([x, y, z0 + 1.2], [0.24, 0.42, 0.6]), cyl([x, y + 0.28, z0 + 1.17], 0.05, 0.6, 'z'), cyl([x, y - 0.28, z0 + 1.17], 0.05, 0.6, 'z'), sph([x, y, z0 + 1.66], 0.12),
];
const win = { color: [96, 150, 200] as [number, number, number], reflectivity: 0.1 };
const glass: [number, number, number] = [120, 165, 200];
const SHOP: [number, number, number][] = [[220, 50, 60], [30, 130, 220], [250, 190, 30], [40, 170, 110], [150, 70, 190], [245, 120, 30]];

function building(x0: number, x1: number, y0: number, y1: number, z0: number, h: number, shop?: 'y0' | 'y1', shopSeed = 0): Primitive[] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, d = y1 - y0;
  const parts: Primitive[] = [box([cx, cy, z0 + h / 2], [w, d, h])];
  const cols = Math.max(1, Math.floor(w / 3.2)), rowsN = Math.max(1, Math.floor(d / 3.2));
  for (let z = 2.4; z < h - 1; z += 3.4) {
    for (let i = 0; i < cols; i++) for (const sy of [y0, y1]) parts.push(box([x0 + (i + 0.5) * (w / cols), sy + (sy === y0 ? -0.04 : 0.04), z0 + z], [1.3, 0.08, 1.5], 0, { mat: win }));
    for (let j = 0; j < rowsN; j++) for (const sx of [x0, x1]) parts.push(box([sx + (sx === x0 ? -0.04 : 0.04), y0 + (j + 0.5) * (d / rowsN), z0 + z], [0.08, 1.3, 1.5], 0, { mat: win }));
  }
  if (shop) {
    // ground-floor shop fronts facing the street: awning, banner and a white lettering strip
    const sy = shop === 'y1' ? y1 : y0, dir = shop === 'y1' ? 1 : -1;
    const n = Math.max(1, Math.floor(w / 4.2));
    for (let i = 0; i < n; i++) {
      const col = SHOP[(shopSeed + i) % SHOP.length], bx = x0 + (i + 0.5) * (w / n), bw = Math.min(3.4, (w / n) - 0.6);
      parts.push(
        box([bx, sy + dir * 0.55, z0 + 2.65], [bw, 1.1, 0.1], 0, { mat: { color: col, reflectivity: 0.5 } }),
        box([bx, sy + dir * 0.08, z0 + 3.3], [bw, 0.14, 0.8], 0, { mat: { color: col, reflectivity: 0.5 } }),
        box([bx, sy + dir * 0.17, z0 + 3.3], [bw * 0.65, 0.06, 0.22], 0, { mat: { color: [250, 250, 250], reflectivity: 0.85 } }),
        box([bx, sy + dir * 0.04, z0 + 1.2], [bw * 0.8, 0.08, 1.7], 0, { mat: { color: [150, 200, 230], reflectivity: 0.15 } }),
      );
    }
  }
  return parts;
}

export function buildCity(): SceneDef {
  const objs: Omit<SceneObject, 'instanceId' | 'scannable'>[] = [];
  const obj = (o: Omit<SceneObject, 'instanceId' | 'scannable'>) => objs.push(o);
  obj({ id: 'road', name: 'Road surface', classId: 13, structural: true, color: [112, 116, 122], reflectivity: 0.15, pattern: 'stripes', parts: [box([0, 1, -0.1], [76, 56, 0.2])] });

  // city blocks (raised pavement slabs) – columns between the north-south roads, rows between the east-west roads
  const cols: [number, number][] = [[-36, -18], [-10, 10], [18, 36]];
  const rows: [number, number][] = [[-22, -4], [4, 20]];
  let bi = 0;
  const BLD: [number, number, number][] = [[226, 190, 140], [196, 108, 94], [150, 190, 214], [232, 212, 120], [176, 200, 160], [210, 150, 120]];
  const bldHeights = [9, 14, 7, 11, 18, 8, 12, 6, 10];
  rows.forEach(([y0, y1], ri) => cols.forEach(([x0, x1], ci) => {
    bi++;
    const id = `block-${bi}`;
    obj({ id, name: `Pavement block ${bi}`, classId: 14, structural: true, color: [206, 204, 198], reflectivity: 0.4, pattern: 'checker', parts: [box([(x0 + x1) / 2, (y0 + y1) / 2, 0.025], [x1 - x0, y1 - y0, 0.25])] });
    if (ri === 1 && ci === 1) return; // the school block is built separately
    const inset = 3;
    const bx0 = x0 + inset, bx1 = x1 - inset, by0 = y0 + inset, by1 = y1 - inset;
    // split the block into two or three buildings along x
    const n = ci === 1 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const w = (bx1 - bx0 - (n - 1) * 1.5) / n, xa = bx0 + k * (w + 1.5);
      obj({ id: `building-${bi}-${k + 1}`, name: `Building ${bi}.${k + 1}`, classId: 17, color: BLD[(bi + k * 2) % BLD.length], reflectivity: 0.55, parts: building(xa, xa + w, by0, by1, 0.15, bldHeights[(bi * 2 + k) % bldHeights.length], ri === 0 ? 'y1' : 'y0', bi + k) });
    }
  }));

  // school (middle block, north row)
  obj({ id: 'school', name: 'School building', classId: 17, color: [196, 120, 90], reflectivity: 0.5, parts: [...building(-8, 8, 6, 12, 0.15, 7), ...building(-8, -2, 12, 18, 0.15, 7)] });
  obj({ id: 'school-sign', name: 'School sign', classId: 18, color: [255, 214, 10], reflectivity: 0.7, parts: [box([2, 5.6, 3.0], [3.5, 0.25, 1.1]), cyl([0.5, 5.6, 1.7], 0.06, 3.2, 'z'), cyl([3.5, 5.6, 1.7], 0.06, 3.2, 'z')] });
  obj({ id: 'flagpole', name: 'Flag pole', classId: 18, color: [220, 220, 225], reflectivity: 0.5, parts: [cyl([6, 10, 4.15], 0.07, 8, 'z'), box([7.1, 10, 7.2], [2, 0.04, 1.2], 0, { mat: { color: [200, 40, 40], reflectivity: 0.4 } })] });
  const fence: Primitive[] = [];
  for (let x = -8; x <= 8; x += 1) fence.push(cyl([x, 19.2, 0.9], 0.04, 1.5, 'z'));
  for (let y = 12; y <= 19; y += 1) fence.push(cyl([8.5, y, 0.9], 0.04, 1.5, 'z'));
  fence.push(box([0, 19.2, 1.4], [17, 0.05, 0.05]), box([8.5, 15.5, 1.4], [0.05, 7.5, 0.05]));
  obj({ id: 'playground-fence', name: 'Playground fence', classId: 20, color: [90, 90, 96], reflectivity: 0.4, parts: fence });
  obj({ id: 'playground', name: 'Playground equipment', classId: 20, color: [230, 90, 60], reflectivity: 0.5, parts: [box([4, 15.5, 0.9], [2.2, 0.2, 1.8]), box([4, 14.3, 0.9], [2.2, 0.2, 1.8]), box([4, 14.9, 1.9], [2.2, 1.4, 0.15])] });

  // vehicles: parked and driving along the long roads
  let vi = 0;
  const addCar = (x: number, y: number, yaw: number, col: [number, number, number]) => obj({ id: `car-${++vi}`, name: `Car ${vi}`, classId: 15, color: col, reflectivity: 0.5, parts: car(x, y, yaw) });
  const cols2: [number, number, number][] = [[220, 40, 45], [40, 110, 225], [245, 245, 245], [250, 130, 30], [250, 205, 30], [40, 170, 100], [30, 175, 190], [150, 80, 200]];
  [-30, -20, -8, 6, 22, 32].forEach((x, i) => addCar(x, -2.3, 0, cols2[i % cols2.length]));
  [-26, -4, 26].forEach((x, i) => addCar(x, 2.3, Math.PI, cols2[(i + 2) % cols2.length]));
  [-28, -2, 24].forEach((x, i) => addCar(x, 22.3, 0, cols2[(i + 1) % cols2.length]));
  [-14, 2, 16].forEach((y, i) => addCar(-12.3, y, Math.PI / 2, cols2[(i + 4) % cols2.length]));
  [-12, 6, 18].forEach((y, i) => addCar(12.3, y, -Math.PI / 2, cols2[i % cols2.length]));
  obj({ id: 'school-bus', name: 'School bus', classId: 15, color: [245, 190, 20], reflectivity: 0.6, parts: bus(-14, 2.4, Math.PI) });
  obj({ id: 'truck-1', name: 'Delivery truck', classId: 15, color: [235, 235, 240], reflectivity: 0.7, parts: truck(14, -12, Math.PI / 2) });
  obj({ id: 'truck-2', name: 'Truck 2', classId: 15, color: [60, 150, 210], reflectivity: 0.5, parts: truck(-14, 12, -Math.PI / 2) });

  // pedestrians: crossings, pavements, the school gate
  const peds: [number, number, number][] = [[-14.5, 0.5, 0], [-13, -1.5, 0], [14.5, 1, 0], [13.2, -1.2, 0], [-14, 23, 0], [14, 25, 0], [-4, 3.6, 0.15], [-9, 21, 0.15], [4, 21.4, 0.15], [24, 5.2, 0.15]];
  peds.forEach(([x, y, z0], i) => obj({ id: `pedestrian-${i + 1}`, name: `Pedestrian ${i + 1}`, classId: 21, color: [255, 140, 60], reflectivity: 0.6, parts: person(x, y, z0) }));

  // street furniture
  const trees: Primitive[][] = [];
  const mk = (x: number, y: number): Primitive[] => [cyl([x, y, 1.5], 0.15, 2.7, 'z', { mat: { color: [95, 70, 50], reflectivity: 0.3 } }), sph([x, y, 4.2], 1.5, { porous: 0.45 })];
  [-30, -4, 22, 32].forEach((x) => trees.push(mk(x, -5.4)));
  [-30, 28].forEach((x) => trees.push(mk(x, 5.4)));
  [8, 14].forEach((y) => trees.push(mk(-11, y)));
  trees.forEach((parts, i) => obj({ id: `tree-${i + 1}`, name: `Tree ${i + 1}`, classId: 16, color: [70, 150, 70], reflectivity: 0.5, parts }));
  const poles: Primitive[] = [];
  for (let x = -30; x <= 30; x += 20) poles.push(cyl([x, 4.7, 3.1], 0.08, 6, 'z'), box([x, 4.2, 6.05], [0.1, 1.1, 0.1]));
  obj({ id: 'lamp-posts', name: 'Lamp posts', classId: 18, color: [90, 90, 96], reflectivity: 0.4, parts: poles });
  const tl: Primitive[] = [];
  for (const [x, y] of [[-18.6, 4.6], [-9.4, -4.6], [9.4, 4.6], [18.6, -4.6]] as [number, number][]) tl.push(cyl([x, y, 2.4], 0.08, 4.8, 'z'), box([x, y, 4.9], [0.35, 0.3, 0.9], 0, { mat: { color: [30, 30, 30], reflectivity: 0.2 } }));
  obj({ id: 'traffic-lights', name: 'Traffic lights', classId: 22, color: [60, 60, 65], reflectivity: 0.3, parts: tl });
  // white road markings: dashed centre lines (gaps at the crossings) and zebra crossings; thin but scannable (bright in intensity)
  const mk2: Primitive[] = [];
  const dash = (x: number, y: number, alongX: boolean) => mk2.push(box([x, y, 0.012], alongX ? [2.2, 0.16, 0.02] : [0.16, 2.2, 0.02]));
  const gap = (v: number, c: number[]) => c.some((k) => Math.abs(v - k) < 6.5);
  for (let x = -36; x <= 36; x += 4) { if (!gap(x, [-14, 14])) dash(x, 0, true); if (!gap(x, [-14, 14])) dash(x, 24.5, true); }
  for (const cx of [-14, 14]) for (let y = -25; y <= 28; y += 4) { if (!gap(y, [0, 24.5])) dash(cx, y, false); }
  for (const [cx, cy] of [[-14, 5.4], [-14, -5.4], [14, 5.4], [14, -5.4], [-14, 21.6], [14, 21.6]] as [number, number][]) for (let k = -3; k <= 3; k++) mk2.push(box([cx + k * 1.0, cy, 0.012], [0.5, 2.4, 0.02]));
  for (const [cx, cy] of [[-19.4, 0], [-8.6, 0], [8.6, 0], [19.4, 0]] as [number, number][]) for (let k = -3; k <= 3; k++) mk2.push(box([cx, cy + k * 1.0, 0.012], [2.4, 0.5, 0.02]));
  obj({ id: 'road-markings', name: 'Road markings', classId: 13, color: [250, 250, 250], reflectivity: 0.85, parts: mk2 });

  return {
    id: 'D', name: 'Scene D · City district (SLAM)',
    description: 'A 76 m × 56 m city district with two long roads, four crossings, a school, parked vehicles, pedestrians, trees and lamp posts. Used by the SLAM & Mobile Scanning tab.',
    objects: finalize(objs as never),
    bounds: { min: [-38, -26, 0], max: [38, 30, 20] },
    defaultPose: { x: -14, y: 0, z: 1.8, yaw: 0 },
    cameraHome: [55, -60, 48], cameraTarget: [0, 2, 2],
  };
}
