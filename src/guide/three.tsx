import { useMemo } from 'react';
import * as THREE from 'three';
import { Rigid, Vec3, cross, norm, scale, add, sub } from '../core/math';
import { PolyLine } from '../ui/three';

/** Places its children by a rigid transform (rotation, then shift), without touching their data. */
export function RigidGroup({ T, children }: { T: Rigid; children: React.ReactNode }) {
  const q = useMemo(() => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(T.R[0], T.R[1], T.R[2], 0, T.R[3], T.R[4], T.R[5], 0, T.R[6], T.R[7], T.R[8], 0, 0, 0, 0, 1)), [T]);
  return <group position={T.t} quaternion={q}>{children}</group>;
}

/** Many thin lines drawn as one object. */
export function Segments({ pts, color, opacity = 0.7 }: { pts: [Vec3, Vec3][]; color: string; opacity?: number }) {
  const geom = useMemo(() => {
    const a = new Float32Array(pts.length * 6);
    pts.forEach(([p, q], i) => a.set([p[0], p[1], p[2], q[0], q[1], q[2]], i * 6));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return g;
  }, [pts]);
  return <lineSegments geometry={geom} frustumCulled={false} raycast={() => null}><lineBasicMaterial color={color} transparent opacity={opacity} depthTest={false} /></lineSegments>;
}

/** A line with an arrow head. */
export function Arrow({ from, to, color, width = 3 }: { from: Vec3; to: Vec3; color: string; width?: number }) {
  const d = sub(to, from), L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-6) return null;
  const u = scale(d, 1 / L), ref: Vec3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], side = norm(cross(u, ref)), h = Math.min(0.25, L * 0.3);
  const base = sub(to, scale(u, h));
  return <>
    <PolyLine pts={[from, to]} color={color} width={width} />
    <PolyLine pts={[add(base, scale(side, h * 0.45)), to, sub(base, scale(side, h * 0.45))]} color={color} width={width} />
  </>;
}

/** An arc around `axis` through `centre`, `angle` rad long, starting in the plane's reference direction. */
export function Arc({ centre, axis, angle, radius, color }: { centre: Vec3; axis: Vec3; angle: number; radius: number; color: string }) {
  const pts = useMemo(() => {
    const ref: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], e1 = norm(cross(axis, ref)), e2 = cross(axis, e1), out: Vec3[] = [];
    const n = Math.max(6, Math.ceil(angle / 0.1));
    for (let i = 0; i <= n; i++) { const a = (angle * i) / n; out.push(add(centre, add(scale(e1, radius * Math.cos(a)), scale(e2, radius * Math.sin(a))))); }
    return out;
  }, [centre, axis, angle, radius]);
  return <PolyLine pts={pts} color={color} width={3} />;
}
