import { PointCloud, makeId } from '../core/pointcloud';

const RGB_OFFSET: Record<number, number> = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };

/** Minimal LAS 1.0–1.4 reader (uncompressed only). Coordinates are re-centred to keep float32 precision. */
export function parseLAS(buf: ArrayBuffer, name = 'cloud.las', maxPoints = 2_000_000): PointCloud {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'LASF') throw new Error('Not a LAS file (missing LASF signature).');
  const rawFmt = dv.getUint8(104);
  if (rawFmt & 0x80) throw new Error('LAZ (compressed LAS) is not supported in the browser build. Convert with PDAL / LAStools (`pdal translate in.laz out.las`) or export PLY.');
  const fmt = rawFmt & 0x3f;
  const offsetToPoints = dv.getUint32(96, true);
  const recLen = dv.getUint16(105, true);
  const versionMinor = dv.getUint8(25);
  let total = dv.getUint32(107, true);
  if (total === 0 && versionMinor >= 4) total = Number(dv.getBigUint64(247, true));
  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true);
  const minX = dv.getFloat64(187, true), minY = dv.getFloat64(203, true), minZ = dv.getFloat64(219, true);
  const stride = Math.max(1, Math.ceil(total / maxPoints));
  const n = Math.ceil(total / stride);
  const c: PointCloud = {
    id: makeId(), name, count: n, positions: new Float32Array(n * 3),
    intensity: new Float32Array(n), labels: new Int32Array(n),
    meta: { kind: 'measured', source: `Uploaded LAS file: ${name}`, units: 'm', createdAt: Date.now(), labelSource: 'ground-truth', notes: [`LAS point format ${fmt}; coordinates re-centred by (${minX.toFixed(2)}, ${minY.toFixed(2)}, ${minZ.toFixed(2)}).`] },
  };
  if (stride > 1) c.meta.notes!.push(`Subsampled every ${stride}th point for browser stability (${total.toLocaleString()} → ${n.toLocaleString()}).`);
  const rgbOff = RGB_OFFSET[fmt];
  if (rgbOff !== undefined) c.colors = new Uint8Array(n * 3);
  let maxI = 1;
  for (let k = 0, i = 0; k < total && i < n; k += stride, i++) {
    const o = offsetToPoints + k * recLen;
    c.positions[i * 3] = dv.getInt32(o, true) * sx + ox - minX;
    c.positions[i * 3 + 1] = dv.getInt32(o + 4, true) * sy + oy - minY;
    c.positions[i * 3 + 2] = dv.getInt32(o + 8, true) * sz + oz - minZ;
    const inten = dv.getUint16(o + 12, true);
    c.intensity![i] = inten;
    if (inten > maxI) maxI = inten;
    c.labels![i] = fmt >= 6 ? dv.getUint8(o + 16) : dv.getUint8(o + 15) & 0x1f;
    if (rgbOff !== undefined) {
      c.colors![i * 3] = dv.getUint16(o + rgbOff, true) >> 8;
      c.colors![i * 3 + 1] = dv.getUint16(o + rgbOff + 2, true) >> 8;
      c.colors![i * 3 + 2] = dv.getUint16(o + rgbOff + 4, true) >> 8;
    }
  }
  for (let i = 0; i < n; i++) c.intensity![i] /= maxI;
  return c;
}
