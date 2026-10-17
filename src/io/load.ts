import { PointCloud } from '../core/pointcloud';
import { parsePLY, writePLY } from './ply';
import { parsePCD, writePCD } from './pcd';
import { parseLAS } from './las';

export function parsePointCloud(buf: ArrayBuffer, filename: string): PointCloud {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'ply') return parsePLY(buf, filename);
  if (ext === 'pcd') return parsePCD(buf, filename);
  if (ext === 'las') return parseLAS(buf, filename);
  if (ext === 'laz') throw new Error('LAZ is compressed and not supported in the browser build. Convert to LAS or PLY first (e.g. `pdal translate in.laz out.las`).');
  throw new Error(`Unsupported file type ".${ext}". Use PLY, PCD or LAS.`);
}

export async function loadFile(file: File): Promise<PointCloud> {
  return parsePointCloud(await file.arrayBuffer(), file.name);
}

export type ExportFormat = 'ply' | 'pcd' | 'ply-ascii' | 'pcd-ascii';
export function exportCloud(c: PointCloud, fmt: ExportFormat): { data: ArrayBuffer; filename: string; mime: string } {
  const base = c.name.replace(/[^\w.-]+/g, '_');
  switch (fmt) {
    case 'ply': return { data: writePLY(c, true), filename: `${base}.ply`, mime: 'application/octet-stream' };
    case 'ply-ascii': return { data: writePLY(c, false), filename: `${base}.ply`, mime: 'text/plain' };
    case 'pcd': return { data: writePCD(c, true), filename: `${base}.pcd`, mime: 'application/octet-stream' };
    default: return { data: writePCD(c, false), filename: `${base}.pcd`, mime: 'text/plain' };
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCloud(c: PointCloud, fmt: ExportFormat) {
  const e = exportCloud(c, fmt);
  downloadBlob(new Blob([e.data], { type: e.mime }), e.filename);
  return e.filename;
}
