import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Slider, Toggle } from '../ui/controls';
import { CloudLayer, PolyLine } from '../ui/three';
import { Play, Download } from '../ui/icons';
import { useLab } from '../state/store';
import { useClassroom } from '../apps/useClassroom';
import { slicePoints, rasterize, extractWalls, straighten, toDXF, segLen, bboxOf, Seg2 } from '../apps/cad';
import { downloadBlob } from '../io/load';
import { PointCloud } from '../core/pointcloud';
import { Credit } from '../ui/VideoCard';

export default function TabScanToCad() {
  const s = useLab();
  const { cloud } = useClassroom(0.02);
  const [z, setZ] = useState(1.2), [thick, setThick] = useState(0.2);
  const [tol, setTol] = useState(0.04), [minLen, setMinLen] = useState(1.0), [gap, setGap] = useState(2.5);
  const [straight, setStraight] = useState(true), [cutAbove, setCutAbove] = useState(true), [showPts, setShowPts] = useState(true);
  const [raw, setRaw] = useState<Seg2[] | null>(null);
  const [busy, setBusy] = useState(false);

  const zMin = z - thick / 2, zMax = z + thick / 2;
  const xy = useMemo(() => (cloud ? slicePoints(cloud.positions, cloud.count, zMin, zMax) : new Float32Array(0)), [cloud, zMin, zMax]);
  // the longest wall sets the main direction; the plan is rotated so walls run along x and y
  const a0 = raw && raw.length ? Math.atan2(raw[0].y2 - raw[0].y1, raw[0].x2 - raw[0].x1) : 0;
  const cad = useMemo(() => (raw ? (straight ? straighten(raw, 10, true) : raw) : null), [raw, straight]);
  const rot = (x: number, y: number): [number, number] => (straight && raw?.length ? [x * Math.cos(-a0) - y * Math.sin(-a0), x * Math.sin(-a0) + y * Math.cos(-a0)] : [x, y]);

  function extract() {
    setBusy(true);
    setTimeout(() => { try { setRaw(extractWalls(xy, { tol, minLen, minPts: 40, maxLines: 14, gap, seed: 4 })); } finally { setBusy(false); } }, 20);
  }
  useEffect(() => { if (cloud && xy.length && !raw) extract(); }, [cloud]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRaw(null); }, [z, thick, tol, minLen, gap]);

  const shown = useMemo<PointCloud | null>(() => {
    if (!cloud) return null;
    const col = cloud.colors!.slice();
    for (let i = 0; i < cloud.count; i++) { const h = cloud.positions[i * 3 + 2]; if (h >= zMin && h <= zMax) { col[i * 3] = 235; col[i * 3 + 1] = 40; col[i * 3 + 2] = 50; } }
    return { ...cloud, colors: col };
  }, [cloud, zMin, zMax]);

  // ---- 2D plan canvas
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 600 });
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1; c.width = size.w * dpr; c.height = size.h * dpr;
    const g = c.getContext('2d')!; g.scale(dpr, dpr); g.fillStyle = '#ffffff'; g.fillRect(0, 0, size.w, size.h);
    if (!cloud) return;
    const pts = new Float32Array(xy.length); for (let i = 0; i < xy.length / 2; i++) { const [x, y] = rot(xy[i * 2], xy[i * 2 + 1]); pts[i * 2] = x; pts[i * 2 + 1] = y; }
    const b = { x0: -5, y0: -7, x1: 5, y1: 7 }; // room is about 8 x 12 m
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < pts.length / 2; i++) { x0 = Math.min(x0, pts[i * 2]); x1 = Math.max(x1, pts[i * 2]); y0 = Math.min(y0, pts[i * 2 + 1]); y1 = Math.max(y1, pts[i * 2 + 1]); }
    if (isFinite(x0)) Object.assign(b, { x0: x0 - 0.5, y0: y0 - 0.5, x1: x1 + 0.5, y1: y1 + 0.5 });
    const k = Math.min((size.w - 40) / (b.x1 - b.x0), (size.h - 90) / (b.y1 - b.y0)), ox = (size.w - k * (b.x1 - b.x0)) / 2, oy = 56;
    const X = (x: number) => ox + (x - b.x0) * k, Y = (y: number) => oy + (b.y1 - y) * k;
    if (showPts) { const gr = rasterize(pts, 0.03, b); for (let j = 0; j < gr.h; j++) for (let i = 0; i < gr.w; i++) { const v = gr.count[j * gr.w + i]; if (v) { g.fillStyle = `rgba(40,45,60,${Math.min(0.9, 0.25 + v / Math.max(4, gr.max) * 0.9)})`; g.fillRect(X(gr.x0 + i * gr.cell), Y(gr.y0 + j * gr.cell) - gr.cell * k, Math.max(1, gr.cell * k), Math.max(1, gr.cell * k)); } } }
    g.font = '600 13px -apple-system, sans-serif';
    g.fillStyle = '#1d1d1f'; g.textAlign = 'left'; g.fillText(`Floor plan · slice ${(zMin).toFixed(2)}–${zMax.toFixed(2)} m above the floor`, 12, 22);
    if (cad) {
      g.strokeStyle = '#0a84ff'; g.lineWidth = 3; g.lineCap = 'round';
      cad.forEach((sg) => { g.beginPath(); g.moveTo(X(sg.x1), Y(sg.y1)); g.lineTo(X(sg.x2), Y(sg.y2)); g.stroke(); });
      g.fillStyle = '#0a60c9'; g.textAlign = 'center';
      cad.forEach((sg) => { const mx = (sg.x1 + sg.x2) / 2, my = (sg.y1 + sg.y2) / 2; const l = `${segLen(sg).toFixed(2)} m`; const w = g.measureText(l).width + 10; g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(X(mx) - w / 2, Y(my) - 10, w, 20); g.fillStyle = '#0a60c9'; g.fillText(l, X(mx), Y(my) + 5); });
    } else { g.fillStyle = '#6e6e73'; g.textAlign = 'center'; g.fillText(busy ? 'Finding walls…' : 'Press “Find walls”', size.w / 2, size.h - 24); }
  }, [size, xy, cad, showPts, cloud, zMin, zMax, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const bb = cad && cad.length ? bboxOf(cad) : null;
  const stats = [
    { k: 'Walls found', v: cad ? String(cad.length) : '—', s: cad ? `${cad.reduce((a, q) => a + segLen(q), 0).toFixed(1)} m of wall` : `${(xy.length / 2).toLocaleString()} points in the slice` },
    { k: 'Room (bounding box)', v: bb ? `${(bb.x1 - bb.x0).toFixed(2)} × ${(bb.y1 - bb.y0).toFixed(2)} m` : '—', s: bb ? `${((bb.x1 - bb.x0) * (bb.y1 - bb.y0)).toFixed(1)} m²` : undefined },
  ];
  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, background: '#d9d9de' }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="cad-3d" hideGrid hideAxes bgOverride="#ffffff" label="The scan: the slice is red" labelPos="tl" labelTop={12} home={[7, -9, 7]} target={[0, 0, 1.2]}>
          {shown && <CloudLayer cloud={shown} mode="rgb" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 300000)} pickable={false} clip={{ on: cutAbove, min: -1, max: zMax + 0.01 }} />}
          {raw && raw.map((sg, i) => <PolyLine key={i} pts={[[sg.x1, sg.y1, z], [sg.x2, sg.y2, z]]} color="#0a84ff" width={4} />)}
        </Viewport>
      </div>
      <div ref={box} style={{ position: 'relative', background: '#fff' }}><canvas ref={cv} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Floor plan" data-testid="plan-canvas" /></div>
    </div>
  );
  const controls = (
    <>
      <Callout kind="edu" title="From scan to CAD drawing">
        A CAD floor plan is a flat drawing of the walls. To make one from a scan: <b>cut a thin horizontal slice</b> through the room (above the furniture, below the ceiling), <b>look at it from above</b> so the walls become lines of points, <b>fit straight lines</b> to those points, then <b>export</b> them as a DXF file for AutoCAD and similar programs.
      </Callout>
      <Section title="1 · Slice the scan">
        <Slider label="Slice height" value={z} min={0.2} max={2.5} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={setZ} hint="Height above the floor. About 1.2 m is above most tables and below the ceiling." />
        <Slider label="Slice thickness" value={thick * 100} min={4} max={60} step={2} unit=" cm" onChange={(v) => setThick(v / 100)} hint="Thicker slices collect more points but also more clutter." />
        <Toggle label="Hide everything above the slice" checked={cutAbove} onChange={setCutAbove} />
      </Section>
      <Section title="2 · Find the walls">
        <Slider label="Line tolerance" value={tol * 100} min={1} max={10} step={0.5} unit=" cm" format={(v) => v.toFixed(1)} onChange={(v) => setTol(v / 100)} hint="How far a point may be from a wall line and still belong to it." />
        <Slider label="Shortest wall" value={minLen} min={0.3} max={4} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={setMinLen} hint="Shorter lines (chairs, tables) are ignored." />
        <Slider label="Bridge gaps up to" value={gap} min={0.3} max={4} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={setGap} hint="Doors and windows leave gaps in the wall. Gaps smaller than this are drawn across, as one wall." />
        <Toggle label="Make corners square (clean-up)" checked={straight} onChange={setStraight} hint="Snaps walls that are almost at right angles to exactly 90° and turns the plan so walls run along x and y." />
        <Btn variant="primary" icon={<Play size={16} />} onClick={extract} busy={busy} disabled={!cloud} testId="find-walls">Find walls</Btn>
      </Section>
      <Section title="3 · Export">
        <div className="btn-row">
          <Btn icon={<Download size={16} />} onClick={() => cad && downloadBlob(new Blob([toDXF(cad)], { type: 'application/dxf' }), 'classroom_walls.dxf')} disabled={!cad || !cad.length} testId="export-dxf">DXF file</Btn>
          <Btn icon={<Download size={16} />} onClick={() => cv.current?.toBlob((b) => b && downloadBlob(b, 'classroom_plan.png'))} disabled={!cad}>Picture (PNG)</Btn>
        </div>
        <p className="hint">The DXF has one line per wall on layer WALLS, in metres. Open it in AutoCAD, BricsCAD, LibreCAD or any CAD viewer.</p>
      </Section>
      <Section title="Tutorial"><Credit keys={['cad']} title="" /></Section>
      <Section title="View"><Toggle label="Show the slice points in the plan" checked={showPts} onChange={setShowPts} /></Section>
    </>
  );
  return <TabFrame title="Scan to CAD" tab={13} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv statsRow stats={stats} hideViewControls />;
}
