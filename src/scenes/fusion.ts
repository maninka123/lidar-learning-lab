import { SceneDef, SceneObject, Primitive, box, cyl, sph, finalize } from './geometry';

/** A bright hall for LiDAR + camera calibration and colour mapping: colourful panels, a colour-checker board, solid coloured objects at different distances. */
export function buildFusionHall(): SceneDef {
  const objs: Omit<SceneObject, 'instanceId' | 'scannable'>[] = [];
  const add = (o: Omit<SceneObject, 'instanceId' | 'scannable'>) => objs.push(o);
  const solid = (id: string, name: string, parts: Primitive[], color: [number, number, number], classId = 20, extra: Partial<SceneObject> = {}) => add({ id, name, classId, parts, color, reflectivity: 0.55, ...extra });
  const W = 12, D = 9, H = 3.5; // hall is x -6..6, y -4.5..4.5

  add({ id: 'floor', name: 'Floor', classId: 1, structural: true, color: [214, 184, 140], reflectivity: 0.4, pattern: 'checker', parts: [box([0, 0, -0.05], [W + 0.4, D + 0.4, 0.1])] });
  add({ id: 'ceiling', name: 'Ceiling', classId: 3, structural: true, hideFlag: 'ceiling', color: [245, 245, 245], reflectivity: 0.7, parts: [box([0, 0, H + 0.05], [W + 0.4, D + 0.4, 0.1])] });
  // front wall: three big colour panels (easy to see where colours land)
  solid('wall-red', 'Front wall (red)', [box([W / 2 + 0.1, -3, H / 2], [0.2, 3, H])], [225, 60, 60], 2, { structural: true });
  solid('wall-yellow', 'Front wall (yellow)', [box([W / 2 + 0.1, 0, H / 2], [0.2, 3, H])], [250, 205, 40], 2, { structural: true });
  solid('wall-blue', 'Front wall (blue)', [box([W / 2 + 0.1, 3, H / 2], [0.2, 3, H])], [50, 115, 225], 2, { structural: true });
  solid('wall-left', 'Left wall (green)', [box([0, D / 2 + 0.1, H / 2], [W + 0.4, 0.2, H])], [70, 175, 95], 2, { structural: true, pattern: 'stripes' });
  solid('wall-right', 'Right wall (orange)', [box([0, -D / 2 - 0.1, H / 2], [W + 0.4, 0.2, H])], [245, 145, 55], 2, { structural: true, pattern: 'stripes' });
  solid('wall-back', 'Back wall (lilac)', [box([-W / 2 - 0.1, 0, H / 2], [0.2, D, H])], [170, 130, 210], 2, { structural: true });

  // colour-checker board on two legs, 3 m in front of the sensor
  const cols: [number, number, number][] = [[230, 50, 50], [250, 200, 40], [60, 180, 90], [40, 120, 230], [200, 70, 200], [30, 190, 200]];
  const squares: Primitive[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) squares.push(box([-0.4 + 3.0 - 0.025 + 0.4, -0.9 + i * 0.3 + 0.15, 0.95 + j * 0.3 + 0.15], [0.03, 0.28, 0.28], 0, { mat: { color: (i + j) % 2 ? cols[i] : [250, 250, 250], reflectivity: 0.7 } }));
  solid('colour-board', 'Colour checker board', [box([3.0 + 0.0, 0, 1.55], [0.05, 1.9, 1.3], 0, { mat: { color: [40, 40, 45], reflectivity: 0.3 } }), ...squares.map((p) => ({ ...p, c: [3.0 - 0.04, p.c[1], p.c[2] + 0.0] as [number, number, number] })), cyl([3.0, -0.7, 0.45], 0.04, 0.9, 'z'), cyl([3.0, 0.7, 0.45], 0.04, 0.9, 'z')], [60, 60, 66], 20);

  // solid coloured objects at different distances
  solid('red-cube', 'Red cube', [box([1.6, -1.5, 0.3], [0.6, 0.6, 0.6], 0.4)], [230, 45, 45], 6);
  solid('blue-cylinder', 'Blue cylinder', [cyl([2.1, 1.7, 0.5], 0.3, 1.0, 'z')], [40, 100, 230], 6);
  solid('green-ball', 'Green ball', [sph([1.9, 0.5, 0.3], 0.3)], [50, 190, 80], 6);
  solid('yellow-table', 'Yellow table', [box([4.3, -2.3, 0.7], [1.4, 0.8, 0.06]), cyl([3.8, -2.6, 0.35], 0.04, 0.7, 'z'), cyl([4.8, -2.6, 0.35], 0.04, 0.7, 'z'), cyl([3.8, -2.0, 0.35], 0.04, 0.7, 'z'), cyl([4.8, -2.0, 0.35], 0.04, 0.7, 'z')], [250, 205, 40], 7);
  solid('orange-box', 'Orange box', [box([4.6, 2.4, 0.6], [0.8, 0.8, 1.2], -0.3)], [245, 120, 30], 6);
  solid('pink-crate', 'Pink crate', [box([0.2, -3.1, 0.4], [0.9, 0.7, 0.8])], [240, 90, 160], 6);
  solid('teal-sofa', 'Teal sofa', [box([-3.0, 3.4, 0.25], [2.0, 0.9, 0.5]), box([-3.0, 3.8, 0.7], [2.0, 0.2, 0.5])], [20, 170, 175], 7);
  solid('purple-pillar', 'Purple pillar', [cyl([-1.2, -2.2, 1.75], 0.25, 3.5, 'z')], [140, 70, 200], 6);
  solid('red-shelf', 'Brown shelf', [box([-4.6, -3.7, 0.9], [2.6, 0.5, 1.8])], [150, 90, 55], 7);
  solid('plant', 'Plant', [cyl([0.8, 3.6, 0.3], 0.22, 0.6, 'z'), sph([0.8, 3.6, 0.95], 0.45)], [60, 160, 70], 16);
  solid('lime-box', 'Lime box', [box([-4.8, 0.6, 0.35], [0.7, 0.9, 0.7], 0.2)], [160, 220, 40], 6);

  return {
    id: 'F',
    name: 'Calibration hall',
    description: 'A bright 12 m × 9 m hall with colour panels, a colour-checker board and coloured objects, built for LiDAR + camera calibration.',
    objects: finalize(objs as never),
    bounds: { min: [-6, -4.5, 0], max: [6, 4.5, H] },
    defaultPose: { x: -3.0, y: 0.0, z: 1.4, yaw: 0 },
    cameraHome: [-9, -8, 6], cameraTarget: [0, 0, 1],
  };
}
