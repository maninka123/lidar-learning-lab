import { PointCloud, makeId, AttrKey } from '../core/pointcloud';

type Scalar = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64';
const TYPE_ALIAS: Record<string, Scalar> = {
  char: 'int8', uchar: 'uint8', short: 'int16', ushort: 'uint16', int: 'int32', uint: 'uint32', float: 'float32', double: 'float64',
  int8: 'int8', uint8: 'uint8', int16: 'int16', uint16: 'uint16', int32: 'int32', uint32: 'uint32', float32: 'float32', float64: 'float64',
};
const SIZE: Record<Scalar, number> = { int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4, float64: 8 };

function readScalar(dv: DataView, off: number, t: Scalar, le: boolean): number {
  switch (t) {
    case 'int8': return dv.getInt8(off);
    case 'uint8': return dv.getUint8(off);
    case 'int16': return dv.getInt16(off, le);
    case 'uint16': return dv.getUint16(off, le);
    case 'int32': return dv.getInt32(off, le);
    case 'uint32': return dv.getUint32(off, le);
    case 'float32': return dv.getFloat32(off, le);
    default: return dv.getFloat64(off, le);
  }
}

interface Prop { name: string; type: Scalar; list?: { count: Scalar; item: Scalar } }
interface Element { name: string; count: number; props: Prop[] }

export function parsePLY(buf: ArrayBuffer, name = 'cloud.ply'): PointCloud {
  const bytes = new Uint8Array(buf);
  const probe = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  const endIdx = probe.indexOf('end_header');
  if (!probe.startsWith('ply') || endIdx < 0) throw new Error('Not a valid PLY file (missing header).');
  const nl = probe.indexOf('\n', endIdx);
  const headerEnd = nl + 1;
  const lines = probe.slice(0, endIdx).split(/\r?\n/);
  let format = 'ascii';
  const elements: Element[] = [];
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: parseInt(t[2], 10), props: [] });
    else if (t[0] === 'property' && elements.length) {
      const el = elements[elements.length - 1];
      if (t[1] === 'list') el.props.push({ name: t[4], type: TYPE_ALIAS[t[3]], list: { count: TYPE_ALIAS[t[2]], item: TYPE_ALIAS[t[3]] } });
      else el.props.push({ name: t[2], type: TYPE_ALIAS[t[1]] });
    }
  }
  const vEl = elements.find((e) => e.name === 'vertex');
  if (!vEl) throw new Error('PLY has no vertex element.');
  const n = vEl.count;
  const cols: Record<string, Float64Array> = {};
  vEl.props.forEach((p) => { if (!p.list) cols[p.name] = new Float64Array(n); });

  if (format === 'ascii') {
    const text = new TextDecoder().decode(bytes.subarray(headerEnd));
    const rows = text.split(/\r?\n/);
    for (let i = 0; i < n; i++) {
      const tok = rows[i].trim().split(/\s+/);
      vEl.props.forEach((p, k) => { if (!p.list) cols[p.name][i] = parseFloat(tok[k]); });
    }
  } else {
    const le = format === 'binary_little_endian';
    const dv = new DataView(buf, headerEnd);
    let off = 0;
    const fixed = vEl.props.every((p) => !p.list);
    const stride = fixed ? vEl.props.reduce((a, p) => a + SIZE[p.type], 0) : 0;
    for (let i = 0; i < n; i++) {
      let o = fixed ? i * stride : off;
      for (const p of vEl.props) {
        if (p.list) {
          const c = readScalar(dv, o, p.list.count, le); o += SIZE[p.list.count] + c * SIZE[p.list.item];
        } else { cols[p.name][i] = readScalar(dv, o, p.type, le); o += SIZE[p.type]; }
      }
      off = o;
    }
  }
  return columnsToCloud(cols, vEl.props, n, name, 'PLY');
}

const pick = (cols: Record<string, Float64Array>, ...names: string[]) => names.map((nm) => cols[nm]).find(Boolean);

export function columnsToCloud(cols: Record<string, Float64Array>, props: { name: string; type: string }[], n: number, name: string, fmt: string): PointCloud {
  const X = pick(cols, 'x'), Y = pick(cols, 'y'), Z = pick(cols, 'z');
  if (!X || !Y || !Z) throw new Error(`${fmt} file has no x/y/z fields.`);
  const c: PointCloud = { id: makeId(), name, count: n, positions: new Float32Array(n * 3), meta: { kind: 'measured', source: `Uploaded ${fmt} file: ${name}`, units: 'm', createdAt: Date.now() } };
  for (let i = 0; i < n; i++) { c.positions[i * 3] = X[i]; c.positions[i * 3 + 1] = Y[i]; c.positions[i * 3 + 2] = Z[i]; }
  const R = pick(cols, 'red', 'r'), G = pick(cols, 'green', 'g'), B = pick(cols, 'blue', 'b');
  if (R && G && B) {
    const isFloat = props.find((p) => p.name === 'red' || p.name === 'r')?.type.startsWith('float');
    const s = isFloat ? 255 : 1;
    c.colors = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) { c.colors[i * 3] = R[i] * s; c.colors[i * 3 + 1] = G[i] * s; c.colors[i * 3 + 2] = B[i] * s; }
  }
  const I = pick(cols, 'intensity', 'scalar_intensity', 'reflectivity', 'scalar_Intensity');
  if (I) {
    let mx = 0;
    for (let i = 0; i < n; i++) if (I[i] > mx) mx = I[i];
    const sc = mx > 1.0001 ? 1 / mx : 1;
    c.intensity = new Float32Array(n);
    for (let i = 0; i < n; i++) c.intensity[i] = I[i] * sc;
    if (sc !== 1) (c.meta.notes ??= []).push(`Intensity rescaled to 0..1 (divided by ${mx}).`);
  }
  const NX = pick(cols, 'nx', 'normal_x'), NY = pick(cols, 'ny', 'normal_y'), NZ = pick(cols, 'nz', 'normal_z');
  if (NX && NY && NZ) {
    c.normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c.normals[i * 3] = NX[i]; c.normals[i * 3 + 1] = NY[i]; c.normals[i * 3 + 2] = NZ[i]; }
  }
  const L = pick(cols, 'class', 'label', 'semantic', 'classification', 'scalar_Classification', 'scalar_Label');
  if (L) { c.labels = new Int32Array(n); for (let i = 0; i < n; i++) c.labels[i] = L[i]; c.meta.labelSource = 'ground-truth'; }
  const IN = pick(cols, 'instance', 'instance_id');
  if (IN) { c.instances = new Int32Array(n); for (let i = 0; i < n; i++) c.instances[i] = IN[i]; }
  const RG = pick(cols, 'range');
  if (RG) { c.ranges = new Float32Array(n); for (let i = 0; i < n; i++) c.ranges[i] = RG[i]; }
  const T = pick(cols, 'time', 'gps_time', 't');
  if (T) { c.times = new Float32Array(n); for (let i = 0; i < n; i++) c.times[i] = T[i]; }
  const SC = pick(cols, 'scan_id');
  if (SC) { c.scanIds = new Uint16Array(n); for (let i = 0; i < n; i++) c.scanIds[i] = SC[i]; }
  return c;
}

export interface WriteProp { name: string; type: 'float' | 'uchar' | 'int' | 'ushort'; get: (i: number) => number }

export function exportProps(c: PointCloud): WriteProp[] {
  const P: WriteProp[] = [
    { name: 'x', type: 'float', get: (i) => c.positions[i * 3] },
    { name: 'y', type: 'float', get: (i) => c.positions[i * 3 + 1] },
    { name: 'z', type: 'float', get: (i) => c.positions[i * 3 + 2] },
  ];
  if (c.colors) (['red', 'green', 'blue'] as const).forEach((nm, k) => P.push({ name: nm, type: 'uchar', get: (i) => c.colors![i * 3 + k] }));
  if (c.intensity) P.push({ name: 'intensity', type: 'float', get: (i) => c.intensity![i] });
  if (c.normals) (['nx', 'ny', 'nz'] as const).forEach((nm, k) => P.push({ name: nm, type: 'float', get: (i) => c.normals![i * 3 + k] }));
  if (c.ranges) P.push({ name: 'range', type: 'float', get: (i) => c.ranges![i] });
  if (c.times) P.push({ name: 'time', type: 'float', get: (i) => c.times![i] });
  if (c.labels) P.push({ name: 'class', type: 'int', get: (i) => c.labels![i] });
  if (c.instances) P.push({ name: 'instance', type: 'int', get: (i) => c.instances![i] });
  if (c.scanIds) P.push({ name: 'scan_id', type: 'ushort', get: (i) => c.scanIds![i] });
  return P;
}
const WSIZE = { float: 4, uchar: 1, int: 4, ushort: 2 } as const;

export function writePLY(c: PointCloud, binary = true): ArrayBuffer {
  const props = exportProps(c);
  const header =
    `ply\nformat ${binary ? 'binary_little_endian' : 'ascii'} 1.0\ncomment LiDAR Learning Lab export (units: metres, Z-up)\ncomment source: ${c.meta.source.replace(/\n/g, ' ')}\n` +
    `comment kind: ${c.meta.kind}\nelement vertex ${c.count}\n` + props.map((p) => `property ${p.type} ${p.name}`).join('\n') + '\nend_header\n';
  const hb = new TextEncoder().encode(header);
  if (!binary) {
    const rows: string[] = [];
    for (let i = 0; i < c.count; i++) rows.push(props.map((p) => (p.type === 'float' ? (+p.get(i).toFixed(6)).toString() : Math.round(p.get(i)).toString())).join(' '));
    const body = new TextEncoder().encode(rows.join('\n') + '\n');
    const out = new Uint8Array(hb.length + body.length);
    out.set(hb); out.set(body, hb.length);
    return out.buffer;
  }
  const stride = props.reduce((a, p) => a + WSIZE[p.type], 0);
  const out = new ArrayBuffer(hb.length + stride * c.count);
  new Uint8Array(out).set(hb);
  const dv = new DataView(out, hb.length);
  for (let i = 0; i < c.count; i++) {
    let o = i * stride;
    for (const p of props) {
      const v = p.get(i);
      if (p.type === 'float') dv.setFloat32(o, v, true);
      else if (p.type === 'uchar') dv.setUint8(o, Math.max(0, Math.min(255, Math.round(v))));
      else if (p.type === 'int') dv.setInt32(o, Math.round(v), true);
      else dv.setUint16(o, Math.round(v), true);
      o += WSIZE[p.type];
    }
  }
  return out;
}

export type { AttrKey };
