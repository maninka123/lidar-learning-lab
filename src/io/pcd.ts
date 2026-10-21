import { PointCloud, selectPoints } from '../core/pointcloud';
import { columnsToCloud, exportProps } from './ply';

function lzfDecompress(input: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  let ip = 0, op = 0;
  while (ip < input.length) {
    let ctrl = input[ip++];
    if (ctrl < 32) {
      ctrl++;
      for (let k = 0; k < ctrl; k++) out[op++] = input[ip++];
    } else {
      let len = ctrl >> 5;
      let ref = op - ((ctrl & 0x1f) << 8) - 1;
      if (len === 7) len += input[ip++];
      ref -= input[ip++];
      len += 2;
      for (let k = 0; k < len; k++) out[op++] = out[ref++];
    }
  }
  return out;
}

export function parsePCD(buf: ArrayBuffer, name = 'cloud.pcd'): PointCloud {
  const bytes = new Uint8Array(buf);
  const probe = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const m = probe.match(/DATA\s+(\w+)\s*\r?\n/);
  if (!m) throw new Error('Not a valid PCD file (missing DATA line).');
  const headerEnd = probe.indexOf(m[0]) + m[0].length;
  const hdr: Record<string, string[]> = {};
  probe.slice(0, headerEnd).split(/\r?\n/).forEach((l) => {
    const t = l.trim().split(/\s+/);
    if (t[0] && !t[0].startsWith('#')) hdr[t[0]] = t.slice(1);
  });
  const fields = hdr.FIELDS, sizes = hdr.SIZE.map(Number), types = hdr.TYPE, counts = (hdr.COUNT ?? fields.map(() => '1')).map(Number);
  const n = parseInt(hdr.POINTS[0], 10);
  const data = m[1];
  const cols: Record<string, Float64Array> = {};
  const props: { name: string; type: string }[] = [];
  const names: string[] = [];
  fields.forEach((f, k) => { if (f === '_' || f.startsWith('_')) return; cols[f] = new Float64Array(n); names.push(f); props.push({ name: f, type: types[k] === 'F' ? 'float' : 'int' }); void counts[k]; });

  const readAt = (dv: DataView, off: number, k: number): number => {
    const sz = sizes[k], ty = types[k];
    if (ty === 'F') return sz === 4 ? dv.getFloat32(off, true) : dv.getFloat64(off, true);
    if (ty === 'U') return sz === 1 ? dv.getUint8(off) : sz === 2 ? dv.getUint16(off, true) : dv.getUint32(off, true);
    return sz === 1 ? dv.getInt8(off) : sz === 2 ? dv.getInt16(off, true) : dv.getInt32(off, true);
  };
  const rowSize = sizes.reduce((a, s, k) => a + s * counts[k], 0);

  if (data === 'ascii') {
    const rows = new TextDecoder().decode(bytes.subarray(headerEnd)).split(/\r?\n/);
    for (let i = 0; i < n; i++) {
      const tok = rows[i].trim().split(/\s+/);
      let c = 0;
      fields.forEach((f, k) => { for (let q = 0; q < counts[k]; q++) { if (q === 0 && cols[f]) cols[f][i] = parseFloat(tok[c]); c++; } });
    }
  } else if (data === 'binary') {
    const dv = new DataView(buf, headerEnd);
    for (let i = 0; i < n; i++) {
      let o = i * rowSize;
      fields.forEach((f, k) => { if (cols[f]) cols[f][i] = readAt(dv, o, k); o += sizes[k] * counts[k]; });
    }
  } else if (data === 'binary_compressed') {
    const head = new DataView(buf, headerEnd, 8);
    const cSize = head.getUint32(0, true), uSize = head.getUint32(4, true);
    const raw = lzfDecompress(bytes.subarray(headerEnd + 8, headerEnd + 8 + cSize), uSize);
    const dv = new DataView(raw.buffer);
    let base = 0;
    fields.forEach((f, k) => {
      for (let i = 0; i < n; i++) if (cols[f]) cols[f][i] = readAt(dv, base + i * sizes[k] * counts[k], k);
      base += n * sizes[k] * counts[k];
    });
  } else throw new Error(`Unsupported PCD DATA type: ${data}`);

  // packed rgb / rgba float or uint32
  const packed = cols.rgb ?? cols.rgba;
  if (packed) {
    const k = fields.indexOf(cols.rgb ? 'rgb' : 'rgba');
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    cols.red = new Float64Array(n); cols.green = new Float64Array(n); cols.blue = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let u: number;
      if (types[k] === 'F') { f32[0] = packed[i]; u = u32[0]; } else u = packed[i] >>> 0;
      cols.red[i] = (u >> 16) & 255; cols.green[i] = (u >> 8) & 255; cols.blue[i] = u & 255;
    }
    props.push({ name: 'red', type: 'uint8' }, { name: 'green', type: 'uint8' }, { name: 'blue', type: 'uint8' });
  }
  const cloud = columnsToCloud(cols, props, n, name, 'PCD');
  // organised clouds (depth cameras) contain NaN points for pixels without a measurement: drop them
  const keep: number[] = [];
  for (let i = 0; i < cloud.count; i++) { const k = i * 3; if (Number.isFinite(cloud.positions[k]) && Number.isFinite(cloud.positions[k + 1]) && Number.isFinite(cloud.positions[k + 2])) keep.push(i); }
  if (keep.length === cloud.count) return cloud;
  const out = selectPoints(cloud, keep, cloud.name);
  (out.meta.notes ??= []).push(`${cloud.count - keep.length} NaN (no-measurement) points removed.`);
  return out;
}

export function writePCD(c: PointCloud, binary = true): ArrayBuffer {
  const props = exportProps(c).filter((p) => !['red', 'green', 'blue'].includes(p.name));
  const hasRgb = !!c.colors;
  const fields: { name: string; size: number; type: string; get: (i: number) => number }[] = props.map((p) => {
    const name = p.name === 'nx' ? 'normal_x' : p.name === 'ny' ? 'normal_y' : p.name === 'nz' ? 'normal_z' : p.name === 'class' ? 'label' : p.name;
    return { name, size: p.type === 'ushort' ? 2 : 4, type: p.type === 'float' ? 'F' : p.type === 'ushort' ? 'U' : 'I', get: p.get };
  });
  if (hasRgb) {
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    fields.splice(3, 0, { name: 'rgb', size: 4, type: 'F', get: (i) => { u32[0] = (c.colors![i * 3] << 16) | (c.colors![i * 3 + 1] << 8) | c.colors![i * 3 + 2]; return f32[0]; } });
  }
  const header =
    `# .PCD v0.7 - LiDAR Learning Lab export (metres, Z-up)\nVERSION 0.7\nFIELDS ${fields.map((f) => f.name).join(' ')}\nSIZE ${fields.map((f) => f.size).join(' ')}\n` +
    `TYPE ${fields.map((f) => f.type).join(' ')}\nCOUNT ${fields.map(() => 1).join(' ')}\nWIDTH ${c.count}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${c.count}\nDATA ${binary ? 'binary' : 'ascii'}\n`;
  const hb = new TextEncoder().encode(header);
  if (!binary) {
    const rows: string[] = [];
    for (let i = 0; i < c.count; i++) rows.push(fields.map((f) => (f.name === 'rgb' ? f.get(i).toPrecision(9) : f.type === 'F' ? (+f.get(i).toFixed(6)).toString() : Math.round(f.get(i)).toString())).join(' '));
    const body = new TextEncoder().encode(rows.join('\n') + '\n');
    const out = new Uint8Array(hb.length + body.length);
    out.set(hb); out.set(body, hb.length);
    return out.buffer;
  }
  const stride = fields.reduce((a, f) => a + f.size, 0);
  const out = new ArrayBuffer(hb.length + stride * c.count);
  new Uint8Array(out).set(hb);
  const dv = new DataView(out, hb.length);
  for (let i = 0; i < c.count; i++) {
    let o = i * stride;
    for (const f of fields) {
      const v = f.get(i);
      if (f.type === 'F') dv.setFloat32(o, v, true);
      else if (f.size === 2) dv.setUint16(o, Math.round(v), true);
      else dv.setInt32(o, Math.round(v), true);
      o += f.size;
    }
  }
  return out;
}
