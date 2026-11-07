import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { SensorMarker } from '../ui/three';
import { prefersReducedMotion } from '../guide/store';
import { D2R, eulerToR, applyR, Vec3 } from '../core/math';
import type { SurfaceSamples } from '../scenes/surface';
import type { SensorConfig } from '../sensor/presets';
import { Scanner, STATION_COLOURS } from './coverage';

/** Seen and hidden stand out; surfaces the sensor does not look at (field of view, range) are pale so they do not read as measured points. */
export const STATUS_COLOURS = ['#30d158', '#ff453a', '#dcc9ee', '#d8d8dd'];
export const STATUS_LABELS = ['Visible: the laser can reach it', 'Hidden: something is in the way', 'Outside the field of view (pale)', 'Too far or too close (pale)'];
const col = (hex: string) => new THREE.Color(hex);

/** The surface samples as coloured dots: the colour says what the scanner(s) can see there. */
export function SamplePoints({ samples, colours, size = 4, onlySeenHidden, maxZ, keep }: { samples: SurfaceSamples; colours: Float32Array; size?: number; /** drop every sample above this height (roof off) */ maxZ?: number; /** keep only the samples whose entry here is non-zero */ keep?: Uint8Array; onlySeenHidden?: Uint8Array /* per-sample status: keep only the visible and hidden ones */ }) {
  const geom = useMemo(() => {
    let pos = samples.pos, colr = colours;
    if (onlySeenHidden || maxZ !== undefined || keep) {
      const idx: number[] = [];
      for (let i = 0; i < samples.count; i++) if ((!onlySeenHidden || onlySeenHidden[i] <= 1) && (!keep || keep[i]) && (maxZ === undefined || samples.pos[i * 3 + 2] <= maxZ)) idx.push(i);
      pos = new Float32Array(idx.length * 3); colr = new Float32Array(idx.length * 3);
      idx.forEach((i, k) => { for (let c = 0; c < 3; c++) { pos[k * 3 + c] = samples.pos[i * 3 + c]; colr[k * 3 + c] = colours[i * 3 + c]; } });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    return g;
  }, [samples, colours, onlySeenHidden, maxZ, keep]);
  useEffect(() => () => geom.dispose(), [geom]);
  return <points geometry={geom} frustumCulled={false} raycast={() => null}><pointsMaterial vertexColors size={size} sizeAttenuation={false} /></points>;
}

/** Fill a colour array from one colour per sample (hex strings from a small palette). */
export function paint(n: number, pick: (i: number) => string): Float32Array {
  const out = new Float32Array(n * 3), cache = new Map<string, THREE.Color>();
  for (let i = 0; i < n; i++) { const h = pick(i); let c = cache.get(h); if (!c) { c = col(h); cache.set(h, c); } out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b; }
  return out;
}

/** Transparent field-of-view volume: a band between the lowest and highest beam, as far as the sensor reaches (drawn at most `reach` m). */
export function FovVolume({ sc, sensor, color, reach, opacity = 0.1 }: { sc: Scanner; sensor: SensorConfig; color: string; reach: number; opacity?: number }) {
  const R = Math.min(sensor.maxRange, reach);
  const geom = useMemo(() => {
    const span = sensor.hFov >= 359.5 ? 360 : sensor.hFov, n = Math.max(8, Math.round(span / 6)), pos: number[] = [];
    const rot = eulerToR(sc.yaw, sc.pitch, 0);
    const P = (az: number, el: number, r: number): Vec3 => { const v = applyR(rot, [r * Math.cos(el) * Math.cos(az), r * Math.cos(el) * Math.sin(az), r * Math.sin(el)]); return [sc.x + v[0], sc.y + v[1], sc.z + v[2]]; };
    const lo = sensor.vMin * D2R, hi = sensor.vMax * D2R, o = P(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const a0 = (-span / 2 + (i / n) * span) * D2R, a1 = (-span / 2 + ((i + 1) / n) * span) * D2R;
      const q = [P(a0, lo, R), P(a1, lo, R), P(a1, hi, R), P(a0, hi, R)];
      pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
      if (span < 359.5 && (i === 0 || i === n - 1)) { const e = i === 0 ? q[0] : q[1], f = i === 0 ? q[3] : q[2]; pos.push(...o, ...e, ...f); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
  }, [sc.x, sc.y, sc.z, sc.yaw, sc.pitch, sensor.hFov, sensor.vMin, sensor.vMax, R]);
  useEffect(() => () => geom.dispose(), [geom]);
  return <mesh geometry={geom} raycast={() => null} renderOrder={2}><meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} /></mesh>;
}

/** The laser fan: lines to where each beam ends, drawn progressively as the scanner turns. Hits end in a dot; misses fade out. */
export function RaySweep({ origin, ends, hit, animate, color = '#0a84ff' }: { origin: Vec3; ends: Float32Array; hit: Uint8Array; animate: boolean; color?: string }) {
  const lineRef = useRef<THREE.LineSegments>(null), ptsRef = useRef<THREE.Points>(null), t = useRef(0);
  const { lg, pg, hitIdx } = useMemo(() => {
    const n = hit.length, lp = new Float32Array(n * 6), lc = new Float32Array(n * 6), hp: number[] = [], idx: number[] = [], c = col(color);
    for (let i = 0; i < n; i++) {
      lp.set(origin, i * 6); lp.set(ends.subarray(i * 3, i * 3 + 3), i * 6 + 3);
      const k = hit[i] ? 1 : 0.35; lc.set([c.r * k, c.g * k, c.b * k, c.r * 0.1, c.g * 0.1, c.b * 0.1], i * 6);
      if (hit[i]) { hp.push(ends[i * 3], ends[i * 3 + 1], ends[i * 3 + 2]); idx.push(i); }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(hp), 3));
    return { lg, pg, hitIdx: idx };
  }, [origin[0], origin[1], origin[2], ends, hit, color]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { lg.dispose(); pg.dispose(); }, [lg, pg]);
  const calm = useMemo(prefersReducedMotion, []);
  const show = (f: number) => {
    const n = hit.length, rays = Math.max(0, Math.min(n, Math.ceil(f * n)));
    lg.setDrawRange(0, rays * 2);
    let h = 0; while (h < hitIdx.length && hitIdx[h] < rays) h++; pg.setDrawRange(0, h);
  };
  useEffect(() => { if (!animate || calm) show(1); else t.current = 0; }, [animate, calm, lg, pg]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => { if (!animate || calm) return; t.current = (t.current + dt / 4) % 1.25; show(Math.min(1, t.current)); });
  return (
    <group>
      <lineSegments ref={lineRef} geometry={lg} frustumCulled={false} raycast={() => null}><lineBasicMaterial vertexColors transparent opacity={0.6} depthWrite={false} /></lineSegments>
      <points ref={ptsRef} geometry={pg} frustumCulled={false} raycast={() => null}><pointsMaterial color="#ff9f0a" size={5} sizeAttenuation={false} /></points>
    </group>
  );
}

/** A scanner standing in the scene: marker, ring when selected, a line down to the floor. */
export function ScannerMarkers({ scanners, selected, sensorOf, labels = true, labelPrefix = 'Scanner', colours = STATION_COLOURS, colourLabels = false, onSelect }: { scanners: Scanner[]; selected: number | null; sensorOf: (s: Scanner) => SensorConfig; labels?: boolean; labelPrefix?: string; colours?: readonly string[]; colourLabels?: boolean; onSelect?: (index: number) => void }) {
  return (
    <>
      {scanners.map((s, i) => {
        const c = colours[i % colours.length] ?? STATION_COLOURS[i % STATION_COLOURS.length], sel = s.id === selected;
        return (
          <group key={s.id} onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(i); } : undefined}>
            {onSelect && <mesh position={[s.x, s.y, s.z]}><sphereGeometry args={[0.3, 10, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>}
            <SensorMarker x={s.x} y={s.y} z={s.z} yaw={s.yaw} pitch={-s.pitch} sensor={sensorOf(s)} color={c} label={labels ? `${labelPrefix} ${i + 1}` : undefined} labelAccent={colourLabels ? c : undefined} showFov={false} scale={sel ? 1.5 : 1} />
            {sel && <Line points={Array.from({ length: 33 }, (_, k) => [s.x + 0.5 * Math.cos((k / 32) * 2 * Math.PI), s.y + 0.5 * Math.sin((k / 32) * 2 * Math.PI), 0.03] as Vec3)} color={c} lineWidth={3} />}
          </group>
        );
      })}
    </>
  );
}
