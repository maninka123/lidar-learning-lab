import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Line, Edges } from '@react-three/drei';
import { PointCloud } from '../core/pointcloud';
import { colorize, ColorMode, ColorOpts } from '../core/colorize';
import { SceneDef, SceneObject, Primitive, objectAABB } from '../scenes/geometry';
import { useLab, pushUndo } from '../state/store';
import { SensorConfig } from '../sensor/presets';
import { Vec3 } from '../core/math';

/** Constant-screen-size text label (canvas sprite). Avoids DOM portals inside the WebGL canvas. */
export function TextSprite({ text, position, height = 0.034, bg = 'rgba(0,0,0,0.72)', color = '#fff', offset = [0, 0.0] }: { text: string; position: Vec3; height?: number; bg?: string; color?: string; offset?: [number, number] }) {
  const { tex, aspect } = useMemo(() => {
    const dpr = 2, fs = 26 * dpr, padX = 14 * dpr, h = 44 * dpr;
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    g.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + padX * 2;
    c.width = w; c.height = h;
    g.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
    g.fillStyle = bg;
    const r = h / 2;
    g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); g.fill();
    g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, padX, h / 2 + 1);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { tex: t, aspect: w / h };
  }, [text, bg, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} center={new THREE.Vector2(0.5 - offset[0], 0.5 - offset[1])} renderOrder={50} raycast={() => null}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

let _round: THREE.Texture | null = null;
/** Soft-edged disc so GL points render as circles, not squares. */
export function roundPointTexture(): THREE.Texture {
  if (_round) return _round;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  _round = new THREE.CanvasTexture(c);
  return _round;
}

// ------------------------------------------------------------------ scene meshes
function PrimMesh({ p, color, opacity, wire, emissive }: { p: Primitive; color: string; opacity: number; wire?: boolean; emissive?: string }) {
  const mat = (
    <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={opacity > 0.85} roughness={0.85} metalness={0} wireframe={wire} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.6 : 0} side={THREE.DoubleSide} />
  );
  return (
    <group position={p.c} rotation={[0, 0, p.yaw]}>
      {p.kind === 'box' && <mesh><boxGeometry args={p.size as Vec3} />{mat}</mesh>}
      {p.kind === 'sphere' && <mesh><sphereGeometry args={[p.r!, 20, 14]} />{mat}</mesh>}
      {p.kind === 'cylinder' && (
        <mesh rotation={p.axis === 'x' ? [0, 0, Math.PI / 2] : p.axis === 'y' ? [0, 0, 0] : [Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[p.r!, p.r!, p.h!, 20]} />{mat}
        </mesh>
      )}
    </group>
  );
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

export function SceneLayer({ scene, opacity, highlight = [], showCeiling, interactive = true, annotate = false, hide = [] }: {
  scene: SceneDef; opacity: number; highlight?: string[]; showCeiling: boolean; interactive?: boolean; annotate?: boolean; hide?: string[];
}) {
  const selected = useLab((s) => s.selectedObjectId);
  return (
    <group>
      {scene.objects.map((o) => {
        if (o.hideFlag === 'ceiling' && !showCeiling) return null;
        if (hide.includes(o.id)) return null;
        const hl = highlight.includes(o.id) || selected === o.id;
        const visualOnly = !o.scannable;
        const op = visualOnly ? Math.min(0.5, opacity + 0.1) : hl ? Math.max(opacity, 0.7) : opacity;
        return (
          <group
            key={o.id}
            onClick={interactive ? (e) => handleSceneClick(e, o) : undefined}
                      >
            {o.parts.map((p, i) => (
              <PrimMesh key={i} p={p} color={visualOnly ? '#d36bff' : rgb(p.mat?.color ?? o.color)} opacity={op} wire={visualOnly} emissive={hl ? '#ff9f0a' : undefined} />
            ))}
            {(hl || annotate) && !o.structural && <BoxOutline bbox={objectAABB(o)} color={hl ? '#ff9f0a' : '#ffb54a'} />}
          </group>
        );
      })}
    </group>
  );
}

function handleSceneClick(e: { stopPropagation: () => void; point: THREE.Vector3 }, o: SceneObject) {
  const s = useLab.getState();
  const pt = e.point;
  if (s.interaction === 'place-sensor') {
    e.stopPropagation();
    const prev = { ...s.pose };
    s.setPose({ x: pt.x, y: pt.y });
    pushUndo('move scanner', () => useLab.getState().setPose(prev));
  } else if (s.interaction === 'add-station') {
    e.stopPropagation();
    s.patch({ pendingStation: [pt.x, pt.y] });
  } else if (s.interaction === 'add-waypoint') {
    e.stopPropagation();
    const w = [...s.waypoints, [pt.x, pt.y] as [number, number]];
    s.patch({ waypoints: w });
    pushUndo('add waypoint', () => useLab.setState({ waypoints: useLab.getState().waypoints.slice(0, -1) }));
  }
}

export function BoxOutline({ bbox, color = '#ff9f0a', dashed = false }: { bbox: { min: Vec3; max: Vec3 }; color?: string; dashed?: boolean }) {
  const size: Vec3 = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];
  const c: Vec3 = [(bbox.max[0] + bbox.min[0]) / 2, (bbox.max[1] + bbox.min[1]) / 2, (bbox.max[2] + bbox.min[2]) / 2];
  return (
    <mesh position={c} raycast={() => null}>
      <boxGeometry args={size} />
      <meshBasicMaterial visible={false} />
      <Edges color={color} dashed={dashed} dashSize={0.06} gapSize={0.04} linewidth={1.5} />
    </mesh>
  );
}

export function CorridorVolume({ scene, color = '#30d158' }: { scene: SceneDef; color?: string }) {
  const c = scene.corridor;
  if (!c) return null;
  const dx = c.end[0] - c.start[0], dy = c.end[1] - c.start[1], L = Math.hypot(dx, dy);
  return (
    <mesh position={[(c.start[0] + c.end[0]) / 2, (c.start[1] + c.end[1]) / 2, c.height / 2]} rotation={[0, 0, Math.atan2(dy, dx)]} raycast={() => null}>
      <boxGeometry args={[L, c.width, c.height]} />
      <meshBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} />
      <Edges color={color} />
    </mesh>
  );
}

// ------------------------------------------------------------------ point clouds
export interface CloudLayerProps {
  cloud: PointCloud;
  mode: ColorMode;
  size: number;
  budget: number;
  colorOpts?: ColorOpts;
  opacity?: number;
  clip?: { on: boolean; min: number; max: number };
  pickable?: boolean;
  onPick?: (index: number) => void; // click on a point: the index in the original cloud
  dim?: boolean;
  visible?: boolean;
}

export function useRenderSubset(cloud: PointCloud, budget: number) {
  return useMemo(() => {
    if (cloud.count <= budget) return null;
    const stride = Math.ceil(cloud.count / budget);
    const n = Math.ceil(cloud.count / stride);
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i * stride;
    return idx;
  }, [cloud, budget]);
}

export function CloudLayer({ cloud, mode, size, budget, colorOpts, opacity = 1, clip, pickable = true, onPick, visible = true }: CloudLayerProps) {
  const subset = useRenderSubset(cloud, budget);
  const geom = useMemo(() => {
    const colors = colorize(cloud, mode, colorOpts);
    const g = new THREE.BufferGeometry();
    if (!subset) {
      g.setAttribute('position', new THREE.BufferAttribute(cloud.positions.subarray(0, cloud.count * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    } else {
      const p = new Float32Array(subset.length * 3), c = new Float32Array(subset.length * 3);
      for (let i = 0; i < subset.length; i++) {
        const s = subset[i] * 3;
        p[i * 3] = cloud.positions[s]; p[i * 3 + 1] = cloud.positions[s + 1]; p[i * 3 + 2] = cloud.positions[s + 2];
        c[i * 3] = colors[s]; c[i * 3 + 1] = colors[s + 1]; c[i * 3 + 2] = colors[s + 2];
      }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    g.computeBoundingSphere();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, mode, subset, colorOpts?.clusterLabels, colorOpts?.heightRange?.[0], colorOpts?.heightRange?.[1], colorOpts?.flat?.join(), colorOpts?.rangeFixed?.join()]);
  useEffect(() => () => geom.dispose(), [geom]);
  const planes = useMemo(() => (clip?.on ? [new THREE.Plane(new THREE.Vector3(0, 0, 1), -clip.min), new THREE.Plane(new THREE.Vector3(0, 0, -1), clip.max)] : []), [clip?.on, clip?.min, clip?.max]);
  if (!visible) return null;
  return (
    <points
      geometry={geom}
      frustumCulled={false}
      onClick={onPick ? (e) => { if (e.index === undefined) return; e.stopPropagation(); onPick(subset ? subset[e.index] : e.index); } : pickable ? (e) => {
        const s = useLab.getState();
        if (s.interaction !== 'pick-points' || e.index === undefined) return;
        e.stopPropagation();
        const orig = subset ? subset[e.index] : e.index;
        const pos: [number, number, number] = [cloud.positions[orig * 3], cloud.positions[orig * 3 + 1], cloud.positions[orig * 3 + 2]];
        const picks = [...s.picks, { cloudId: cloud.id, index: orig, pos }];
        s.patch({ picks });
        pushUndo('pick point', () => useLab.setState({ picks: useLab.getState().picks.slice(0, -1) }));
      } : undefined}
    >
      <pointsMaterial vertexColors size={size} sizeAttenuation={false} transparent={opacity < 1} opacity={opacity} clippingPlanes={planes} depthWrite={opacity >= 1} map={roundPointTexture()} alphaTest={0.5} />
    </points>
  );
}

export function PickLayer({ radius = 0.05 }: { radius?: number }) {
  const picks = useLab((s) => s.picks);
  return (
    <group>
      {picks.map((p, i) => (
        <group key={i} position={p.pos}>
          <mesh raycast={() => null}><sphereGeometry args={[radius, 14, 10]} /><meshBasicMaterial color="#ffd60a" depthTest={false} /></mesh>
          <TextSprite text={`P${i + 1}`} position={[0, 0, radius * 2.8]} />
        </group>
      ))}
      {picks.slice(1).map((p, i) => {
        const a = picks[i].pos, b = p.pos;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        return (
          <group key={`l${i}`}>
            <Line points={[a, b]} color="#ffd60a" lineWidth={2} depthTest={false} />
            <TextSprite text={`${d.toFixed(3)} m`} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} bg="rgba(120,80,0,0.9)" />
          </group>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------ sensor
export function SensorMarker({ x, y, z, yaw, pitch = 0, scale = 1, sensor, color = '#0a84ff', label, showFov = true }: { x: number; y: number; z: number; yaw: number; pitch?: number; scale?: number; sensor?: SensorConfig; color?: string; label?: string; showFov?: boolean }) {
  const fov = useMemo(() => {
    if (!sensor || !showFov) return null;
    const R = Math.min(sensor.maxRange, 3.5);
    if (sensor.hFov >= 359) {
      const pts: Vec3[] = [];
      for (let i = 0; i <= 72; i++) pts.push([R * Math.cos((i / 72) * Math.PI * 2), R * Math.sin((i / 72) * Math.PI * 2), 0]);
      return pts;
    }
    const pts: Vec3[] = [[0, 0, 0]];
    const h = (sensor.hFov / 2) * (Math.PI / 180);
    for (let i = 0; i <= 24; i++) { const a = -h + (i / 24) * 2 * h; pts.push([R * Math.cos(a), R * Math.sin(a), 0]); }
    pts.push([0, 0, 0]);
    return pts;
  }, [sensor?.hFov, sensor?.maxRange, showFov]);
  return (
    <group position={[x, y, z]} rotation={[0, 0, yaw]}>
      <group rotation={[0, -pitch, 0]} scale={scale}>
      <mesh raycast={() => null} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.1, 0.16, 20]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} /></mesh>
      <mesh position={[0.18, 0, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={() => null}><coneGeometry args={[0.06, 0.16, 12]} /><meshBasicMaterial color="#ffffff" /></mesh>
      {fov && <Line points={fov} color={color} lineWidth={1} transparent opacity={0.6} />}
      </group>
      <Line points={[[0.2, 0, 0], [1.6, 0, 0]]} color="#000000" lineWidth={3} depthTest={false} />
      <mesh position={[1.7, 0, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={() => null}><coneGeometry args={[0.1, 0.24, 14]} /><meshBasicMaterial color="#000000" depthTest={false} /></mesh>
      <Line points={[[0, 0, 0], [0, 0, -z]]} color={color} lineWidth={1} dashed dashSize={0.08} gapSize={0.06} />
      {label && <TextSprite text={label} position={[0, 0, 0.35]} />}
    </group>
  );
}

export function RayLines({ origin, ends, hit }: { origin: Vec3; ends: Float32Array; hit: Uint8Array }) {
  const { lineGeom, pointGeom } = useMemo(() => {
    const n = hit.length;
    const lp = new Float32Array(n * 6), lc = new Float32Array(n * 6);
    const hp: number[] = [];
    for (let i = 0; i < n; i++) {
      lp.set(origin, i * 6); lp.set(ends.subarray(i * 3, i * 3 + 3), i * 6 + 3);
      const c = hit[i] ? [0.2, 0.75, 1] : [0.45, 0.45, 0.5];
      lc.set([...c.map((v) => v * 0.9), ...c.map((v) => v * 0.15)], i * 6);
      if (hit[i]) hp.push(ends[i * 3], ends[i * 3 + 1], ends[i * 3 + 2]);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(hp), 3));
    return { lineGeom: lg, pointGeom: pg };
  }, [origin[0], origin[1], origin[2], ends, hit]);
  return (
    <group>
      <lineSegments geometry={lineGeom} frustumCulled={false} raycast={() => null}><lineBasicMaterial vertexColors transparent opacity={0.55} depthWrite={false} /></lineSegments>
      <points geometry={pointGeom} frustumCulled={false} raycast={() => null}><pointsMaterial color="#ff9f0a" size={5} sizeAttenuation={false} /></points>
    </group>
  );
}

export function PolyLine({ pts, color, width = 2, dashed }: { pts: Vec3[]; color: string; width?: number; dashed?: boolean }) {
  if (pts.length < 2) return null;
  return <Line points={pts} color={color} lineWidth={width} dashed={dashed} dashSize={0.15} gapSize={0.1} />;
}

export function Marker({ p, color, r = 0.08, label }: { p: Vec3; color: string; r?: number; label?: string }) {
  const ref = useRef<THREE.Mesh>(null);
  return (
    <group position={p}>
      <mesh ref={ref} raycast={() => null}><sphereGeometry args={[r, 14, 10]} /><meshBasicMaterial color={color} /></mesh>
      {label && <TextSprite text={label} position={[0, 0, r * 2.8]} />}
    </group>
  );
}

export function MeshLayer({ mesh, color = '#bf5af2', opacity = 0.9, wire = false, colors, flat = true }: { mesh: { positions: Float32Array; indices: Uint32Array }; color?: string; opacity?: number; wire?: boolean; colors?: Uint8Array | null; flat?: boolean }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    if (colors && colors.length === mesh.positions.length) g.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
    g.computeVertexNormals();
    return g;
  }, [mesh, colors]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} raycast={() => null}>
      <meshStandardMaterial color={colors ? '#ffffff' : color} vertexColors={!!colors} transparent={opacity < 1} opacity={opacity} wireframe={wire} flatShading={flat} side={THREE.DoubleSide} roughness={0.8} />
    </mesh>
  );
}

/**
 * Draw a rectangle on the view with the mouse (like CloudCompare's segment tool): every point that falls inside the rectangle on the
 * screen is selected, and the smallest box around them is reported. The camera is locked while drawing; Escape cancels.
 */
export function ScreenBoxSelect({ active, cloud, onBox, onCancel }: { active: boolean; cloud: PointCloud | null; onBox: (min: Vec3, max: Vec3, count: number, viewAxis: 0 | 1 | 2) => void; onCancel?: () => void }) {
  const { camera, gl, controls } = useThree();
  const cb = useRef({ onBox, onCancel });
  cb.current = { onBox, onCancel };
  useEffect(() => {
    if (!active || !cloud) return;
    const el = gl.domElement, host = el.parentElement;
    if (!host) return;
    const ctl = controls as unknown as { enabled: boolean } | null;
    const was = ctl?.enabled; if (ctl) ctl.enabled = false;
    const cursor = el.style.cursor; el.style.cursor = 'crosshair';
    const band = document.createElement('div');
    Object.assign(band.style, { position: 'absolute', border: '2px dashed #0a84ff', background: 'rgba(10,132,255,.14)', pointerEvents: 'none', display: 'none', zIndex: '6' });
    host.appendChild(band);
    let start: [number, number] | null = null;
    const at = (e: PointerEvent): [number, number] => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const draw = (a: [number, number], b: [number, number]) => { band.style.left = `${Math.min(a[0], b[0])}px`; band.style.top = `${Math.min(a[1], b[1])}px`; band.style.width = `${Math.abs(a[0] - b[0])}px`; band.style.height = `${Math.abs(a[1] - b[1])}px`; };
    const down = (e: PointerEvent) => { if (e.button !== 0) return; e.preventDefault(); start = at(e); band.style.display = 'block'; draw(start, start); try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
    const move = (e: PointerEvent) => { if (start) draw(start, at(e)); };
    const up = (e: PointerEvent) => {
      if (!start) return;
      const a = start, b = at(e); start = null; band.style.display = 'none';
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      if (x1 - x0 < 6 || y1 - y0 < 6) return;
      const r = el.getBoundingClientRect(), v = new THREE.Vector3();
      camera.updateMatrixWorld();
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
      let n = 0;
      for (let i = 0; i < cloud.count; i++) {
        const px = cloud.positions[i * 3], py = cloud.positions[i * 3 + 1], pz = cloud.positions[i * 3 + 2];
        v.set(px, py, pz).project(camera);
        if (v.z < -1 || v.z > 1) continue;
        const sx = ((v.x + 1) / 2) * r.width, sy = ((1 - v.y) / 2) * r.height;
        if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
        n++;
        if (px < min[0]) min[0] = px; if (py < min[1]) min[1] = py; if (pz < min[2]) min[2] = pz;
        if (px > max[0]) max[0] = px; if (py > max[1]) max[1] = py; if (pz > max[2]) max[2] = pz;
      }
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      const ax = Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z) ? 0 : Math.abs(dir.y) >= Math.abs(dir.z) ? 1 : 2; // the axis we are looking along
      if (n > 0) cb.current.onBox(min, max, n, ax);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cb.current.onCancel?.(); };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); window.removeEventListener('keydown', key);
      band.remove(); el.style.cursor = cursor; if (ctl && was !== undefined) ctl.enabled = was;
    };
  }, [active, cloud, camera, gl, controls]);
  return null;
}
