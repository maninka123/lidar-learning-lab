import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Slider, Toggle } from '../ui/controls';
import { CloudLayer, PolyLine } from '../ui/three';
import { Download } from '../ui/icons';
import { useLab } from '../state/store';
import { useClassroom } from '../apps/useClassroom';
import { slicePoints, rasterize, extractPlanBands, toDXF, segLen, bboxOf } from '../apps/cad';
import { downloadBlob } from '../io/load';
import { PointCloud } from '../core/pointcloud';
import { Credit } from '../ui/VideoCard';

const INK = '#16325c', ACCENT = '#0a84ff';

export default function TabScanToCad() {
  const s = useLab();
  const { cloud } = useClassroom(0.02);
  const [z, setZ] = useState(1.4), [thick, setThick] = useState(1.6);
  const [tol, setTol] = useState(0.08), [minLen, setMinLen] = useState(1.0), [gap, setGap] = useState(2.5);
  const [cutAbove, setCutAbove] = useState(true), [showPts, setShowPts] = useState(true);

  const zMin = z - thick / 2, zMax = z + thick / 2;
  const xy = useMemo(() => (cloud ? slicePoints(cloud.positions, cloud.count, zMin, zMax) : new Float32Array(0)), [cloud, zMin, zMax]);
  const plan = useMemo(() => (cloud ? extractPlanBands(cloud.positions, cloud.count, zMin, zMax, { tol, minLen, gap }) : { angle: 0, walls: [], world: [] }), [cloud, zMin, zMax, tol, minLen, gap]);

  const shown = useMemo<PointCloud | null>(() => {
    if (!cloud) return null;
    const col = cloud.colors!.slice();
    for (let i = 0; i < cloud.count; i++) { const h = cloud.positions[i * 3 + 2]; if (h >= zMin && h <= zMax) { col[i * 3] = 235; col[i * 3 + 1] = 40; col[i * 3 + 2] = 50; } }
    return { ...cloud, colors: col };
  }, [cloud, zMin, zMax]);

  // ---- the floor plan, drawn like a drawing sheet
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 600 });
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); return () => ro.disconnect(); }, []);
  const bb = plan.walls.length ? bboxOf(plan.walls) : null;
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = size.w, H = size.h;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!; g.scale(dpr, dpr);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.font = '600 14px -apple-system, sans-serif'; g.fillStyle = '#1d1d1f'; g.textAlign = 'left';
    g.fillText(`Floor plan · slice ${zMin.toFixed(2)}–${zMax.toFixed(2)} m above the floor`, 16, 26);
    const ca = Math.cos(-plan.angle), sa = Math.sin(-plan.angle);
    const pts = new Float32Array(xy.length); for (let i = 0; i < xy.length / 2; i++) { pts[i * 2] = xy[i * 2] * ca - xy[i * 2 + 1] * sa; pts[i * 2 + 1] = xy[i * 2] * sa + xy[i * 2 + 1] * ca; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length / 2; i++) { x0 = Math.min(x0, pts[i * 2]); x1 = Math.max(x1, pts[i * 2]); y0 = Math.min(y0, pts[i * 2 + 1]); y1 = Math.max(y1, pts[i * 2 + 1]); }
    if (!isFinite(x0)) { g.fillStyle = '#6e6e73'; g.font = '14px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText('No points in this slice: move it to where there are walls.', W / 2, H / 2); return; }
    if (bb) { x0 = Math.min(x0, bb.x0); x1 = Math.max(x1, bb.x1); y0 = Math.min(y0, bb.y0); y1 = Math.max(y1, bb.y1); }
    const pad = 64, top = 44, k = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - top - pad) / (y1 - y0 || 1));
    const ox = (W - k * (x1 - x0)) / 2, oy = top + (H - top - pad - k * (y1 - y0)) / 2;
    const X = (x: number) => ox + (x - x0) * k, Y = (y: number) => oy + (y1 - y) * k;
    // 1 m grid
    g.lineWidth = 1;
    for (let gx = Math.ceil(x0); gx <= x1; gx++) { g.strokeStyle = gx % 5 === 0 ? '#d9dce3' : '#eef0f4'; g.beginPath(); g.moveTo(X(gx), Y(y1)); g.lineTo(X(gx), Y(y0)); g.stroke(); }
    for (let gy = Math.ceil(y0); gy <= y1; gy++) { g.strokeStyle = gy % 5 === 0 ? '#d9dce3' : '#eef0f4'; g.beginPath(); g.moveTo(X(x0), Y(gy)); g.lineTo(X(x1), Y(gy)); g.stroke(); }
    // room tint
    if (bb) { g.fillStyle = 'rgba(10,132,255,.06)'; g.fillRect(X(bb.x0), Y(bb.y1), (bb.x1 - bb.x0) * k, (bb.y1 - bb.y0) * k); }
    // the slice, as faint dots
    if (showPts) { const gr = rasterize(pts, 0.04, { x0, y0, x1, y1 }); for (let j = 0; j < gr.h; j++) for (let i = 0; i < gr.w; i++) { const v = gr.count[j * gr.w + i]; if (v) { g.fillStyle = `rgba(80,90,110,${Math.min(0.55, 0.18 + (v / Math.max(6, gr.max)) * 0.6)})`; const px = Math.max(1.5, gr.cell * k); g.fillRect(X(gr.x0 + i * gr.cell), Y(gr.y0 + j * gr.cell) - px, px, px); } } }
    // the walls
    g.lineCap = 'round'; g.strokeStyle = INK; g.lineWidth = 6;
    plan.walls.forEach((w) => { g.beginPath(); g.moveTo(X(w.x1), Y(w.y1)); g.lineTo(X(w.x2), Y(w.y2)); g.stroke(); });
    // dimensions outside the room, with ticks
    g.font = '600 13px -apple-system, sans-serif'; g.textAlign = 'center';
    const dim = (ax: number, ay: number, bx: number, by: number, text: string, nx: number, ny: number) => {
      const off = 26, p1: [number, number] = [X(ax) + nx * off, Y(ay) + ny * off], p2: [number, number] = [X(bx) + nx * off, Y(by) + ny * off];
      g.strokeStyle = ACCENT; g.lineWidth = 1.2; g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.moveTo(X(ax) + nx * 8, Y(ay) + ny * 8); g.lineTo(p1[0] + nx * 5, p1[1] + ny * 5); g.moveTo(X(bx) + nx * 8, Y(by) + ny * 8); g.lineTo(p2[0] + nx * 5, p2[1] + ny * 5); g.stroke();
      const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2, w = g.measureText(text).width + 14;
      g.fillStyle = '#ffffff'; g.fillRect(mx - w / 2, my - 11, w, 22); g.strokeStyle = ACCENT; g.lineWidth = 1; g.strokeRect(mx - w / 2, my - 11, w, 22);
      g.fillStyle = ACCENT; g.fillText(text, mx, my + 5);
    };
    if (bb) {
      dim(bb.x0, bb.y0, bb.x1, bb.y0, `${(bb.x1 - bb.x0).toFixed(2)} m`, 0, 1);
      dim(bb.x1, bb.y0, bb.x1, bb.y1, `${(bb.y1 - bb.y0).toFixed(2)} m`, 1, 0);
    }
    // a wall that is only part of a side (an opening splits it) gets its own length
    g.fillStyle = INK; g.font = '12px -apple-system, sans-serif';
    plan.walls.forEach((w) => { const L = segLen(w); if (bb && (L > (bb.x1 - bb.x0) * 0.97 || L > (bb.y1 - bb.y0) * 0.97)) return; const mx = (X(w.x1) + X(w.x2)) / 2, my = (Y(w.y1) + Y(w.y2)) / 2; const horiz = Math.abs(w.y2 - w.y1) < 1e-6; g.fillText(`${L.toFixed(1)} m`, mx + (horiz ? 0 : -26), my + (horiz ? -10 : 4)); });
    // scale bar and room summary
    g.strokeStyle = '#1d1d1f'; g.lineWidth = 3; g.beginPath(); g.moveTo(16, H - 22); g.lineTo(16 + k, H - 22); g.stroke();
    g.fillStyle = '#1d1d1f'; g.font = '12px -apple-system, sans-serif'; g.textAlign = 'left'; g.fillText('1 m', 16 + k + 8, H - 18);
    if (bb) { g.textAlign = 'right'; g.font = '600 13px -apple-system, sans-serif'; g.fillText(`Room ${(bb.x1 - bb.x0).toFixed(2)} × ${(bb.y1 - bb.y0).toFixed(2)} m · ${((bb.x1 - bb.x0) * (bb.y1 - bb.y0)).toFixed(1)} m²`, W - 16, H - 18); }
  }, [size, xy, plan, showPts, zMin, zMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = plan.walls.reduce((a, q) => a + segLen(q), 0);
  const stats = [
    { k: 'Walls found', v: String(plan.walls.length), s: `${total.toFixed(1)} m of wall` },
    { k: 'Room (bounding box)', v: bb ? `${(bb.x1 - bb.x0).toFixed(2)} × ${(bb.y1 - bb.y0).toFixed(2)} m` : '—', s: bb ? `${((bb.x1 - bb.x0) * (bb.y1 - bb.y0)).toFixed(1)} m²` : `${(xy.length / 2).toLocaleString()} points in the slice` },
  ];
  const dxfWalls = useMemo(() => (bb ? plan.walls.map((w) => ({ x1: w.x1 - bb.x0, y1: w.y1 - bb.y0, x2: w.x2 - bb.x0, y2: w.y2 - bb.y0 })) : []), [plan, bb]);

  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 2, background: '#d9d9de' }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="cad-3d" hideGrid hideAxes bgOverride="#ffffff" label="The scan: the slice is red" labelPos="tl" labelTop={12} home={[8.5, -10, 8]} target={[0, 0, 1]}>
          {shown && <CloudLayer cloud={shown} mode="rgb" size={Math.max(2, s.view.pointSize)} budget={Math.max(s.view.renderBudget, 300000)} pickable={false} clip={{ on: cutAbove, min: -1, max: zMax + 0.01 }} />}
          {plan.world.map((sg, i) => <PolyLine key={i} pts={[[sg.x1, sg.y1, z], [sg.x2, sg.y2, z]]} color={ACCENT} width={5} />)}
        </Viewport>
      </div>
      <div ref={box} style={{ position: 'relative', background: '#fff' }}><canvas ref={cv} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Floor plan" data-testid="plan-canvas" /></div>
    </div>
  );
  const controls = (
    <>
      <Callout kind="edu" title="From scan to CAD drawing">
        A CAD floor plan is a flat drawing of the walls. Cut a <b>thin horizontal slice</b> through the room (above the furniture, below the ceiling), look at it <b>from above</b> so the walls become lines of points, <b>draw a wall</b> where the points pile up, then <b>export</b> a DXF for AutoCAD and similar programs.
      </Callout>
      <Section title="1 · Slice the scan">
        <Slider label="Slice height" value={z} min={0.2} max={2.4} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={setZ} hint="Height above the floor. About 1.4 m is above the tables and below the ceiling." />
        <Slider label="Slice thickness" value={thick * 100} min={4} max={160} step={2} unit=" cm" onChange={(v) => setThick(v / 100)} hint="Walls are often hidden behind cabinets low down and have windows higher up. A thicker slice sees both, so each wall shows up. Too thick and furniture creeps in." />
        <Toggle label="Hide everything above the slice" checked={cutAbove} onChange={setCutAbove} />
      </Section>
      <Section title="2 · Draw the walls">
        <Slider label="Wall thickness it accepts" value={tol * 100} min={2} max={20} step={1} unit=" cm" onChange={(v) => setTol(v / 100)} hint="How far a point may be from a wall line and still count as that wall." />
        <Slider label="Shortest wall" value={minLen} min={0.3} max={4} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={setMinLen} hint="Shorter pieces (chairs, tables) are ignored." />
        <Slider label="Bridge openings up to" value={gap} min={0.3} max={4} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={setGap} hint="Doors and windows leave gaps in the points. Gaps smaller than this are drawn across, as one wall." />
        <p className="hint">The plan is turned so the walls run along the page: the longest wall sets the direction, and every wall is drawn at an exact right angle.</p>
      </Section>
      <Section title="3 · Export">
        <div className="btn-row">
          <Btn icon={<Download size={16} />} onClick={() => dxfWalls.length && downloadBlob(new Blob([toDXF(dxfWalls)], { type: 'application/dxf' }), 'classroom_walls.dxf')} disabled={!dxfWalls.length} testId="export-dxf">DXF file</Btn>
          <Btn icon={<Download size={16} />} onClick={() => cv.current?.toBlob((b) => b && downloadBlob(b, 'classroom_plan.png'))} disabled={!plan.walls.length}>Picture (PNG)</Btn>
        </div>
        <p className="hint">The DXF has one line per wall on layer WALLS, in metres, with the room's corner at 0, 0. Open it in AutoCAD, BricsCAD, LibreCAD or any CAD viewer.</p>
      </Section>
      <Section title="Tutorial"><Credit keys={['cad']} title="" /></Section>
      <Section title="View"><Toggle label="Show the slice points in the plan" checked={showPts} onChange={setShowPts} /></Section>
    </>
  );
  return <TabFrame title="Scan to CAD" tab={13} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv statsRow stats={stats} hideViewControls />;
}
