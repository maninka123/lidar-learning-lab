import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import type { SceneId } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneFromStore } from './common';
import { CloudLayer } from '../ui/three';
import { Plan2D } from '../ui/Plan2D';
import { Boxes, Circle, Crosshair, Dots, EyeOff, Pause, Play, Plus, Trash2 } from '../ui/icons';
import { PRESETS, PRESET_GROUPS } from '../sensor/presets';
import { staticPose } from '../sensor/simulate';
import { runTask } from '../engine/client';
import type { PointCloud } from '../core/pointcloud';
import { D2R } from '../core/math';
import { Scanner, MAX_SCANNERS, STATION_COLOURS, evaluate, rayFan, sensorOf, insideSolid, statusShares, compareArrangements, SEEN } from '../occlusion/coverage';
import { CHALLENGES, Challenge, evaluateChallenge, advice } from '../occlusion/challenges';
import { FovVolume, RaySweep, SamplePoints, ScannerMarkers, STATUS_COLOURS, STATUS_LABELS, paint } from '../occlusion/OccView';
import { ConvergenceChart, GuideClock, GuidePanel, GuideStep } from '../ui/Guide';
import { useOccGuide } from '../guide/store';
import { tabIndex } from './nav';

type Act = 'explore' | 'design' | 'compare';
type Mode = 'heat' | 'owner' | 'unique';
const HEAT = ['#ff453a', '#30d158', '#0a84ff'], NEUTRAL = '#c7c7cc';
const DEFAULT_Z: Record<string, number> = { A: 1.5, B: 1.6, C: 1.8 };
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)} %`;
const mk = (id: number, x: number, y: number, z: number, preset: string, yaw = 0, pitch = 0): Scanner => ({ id, x, y, z, yaw, pitch, preset });

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
const facing = (scene: ReturnType<typeof getScene>, x: number, y: number) => { const cx = (scene.bounds.min[0] + scene.bounds.max[0]) / 2, cy = (scene.bounds.min[1] + scene.bounds.max[1]) / 2; return Math.atan2(cy - y, cx - x); };

/** Pick a few real positions for the walkthrough: a poor and a good place for one scanner, and where a second one helps most. */
function demoPlan(scene: ReturnType<typeof getScene>, preset: string) {
  const b = scene.bounds, z = DEFAULT_Z[scene.id] ?? 1.5, cands: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { const x = b.min[0] + 0.6 + ((i + 0.5) / 6) * (b.max[0] - b.min[0] - 1.2), y = b.min[1] + 0.6 + ((j + 0.5) / 4) * (b.max[1] - b.min[1] - 1.2); if (!insideSolid(scene, x, y, z)) cands.push({ x, y }); }
  const cov = (list: { x: number; y: number }[]) => evaluate(scene, list.map((p, i) => mk(i, p.x, p.y, z, preset)), 2500).stats.coverage;
  const single = cands.map((c) => ({ ...c, cov: cov([c]) })).sort((a, b2) => a.cov - b2.cov);
  const poor = single[Math.floor(single.length * 0.1)], good = single[single.length - 1];
  const chosen = [good], curve = [good.cov];
  for (let k = 1; k < MAX_SCANNERS; k++) { let best = cands[0], bc = -1; for (const c of cands) { const v = cov([...chosen, c]); if (v > bc) { bc = v; best = c; } } chosen.push({ ...best, cov: bc }); curve.push(bc); }
  return { poor, good, second: chosen[1], curve, z };
}

export default function TabOcclusion() {
  const s = useLab();
  const sceneId = s.sceneId as SceneId, scene = getScene(sceneId);
  const z0 = DEFAULT_Z[sceneId] ?? 1.5;
  const [act, setAct] = useState<Act>('explore');
  const [ex, setEx] = useState<Scanner>(() => mk(0, scene.defaultPose.x, scene.defaultPose.y, z0, 'tls', scene.defaultPose.yaw));
  const [draft, setDraft] = useState<Scanner[]>([]); // the placement being built in Design
  const [saved, setSaved] = useState<{ A: Scanner[]; B: Scanner[] }>({ A: [], B: [] }); // placements sent to Compare from Design
  const [sel, setSel] = useState<number | null>(null);
  const [tool, setTool] = useState(true);
  const [beams, setBeams] = useState<'play' | 'pause' | 'hide'>('play'), animate = beams === 'play', [showVis, setShowVis] = useState(true), [showFov, setShowFov] = useState(false);
  const [mode, setMode] = useState<Mode>('heat'), [showDiff, setShowDiff] = useState(true);
  const [chal, setChal] = useState<Challenge | null>(null);
  const [scans, setScans] = useState<Record<number, { cloud: PointCloud; key: string }>>({});
  const [showScans, setShowScans] = useState(false), [busy, setBusy] = useState(false);
  const [look, setLook] = useState<'scene' | 'cloud' | 'dots'>('scene'), pointsOnly = look !== 'scene'; // cloud: scene hidden, only the scanned points (the surface dots when nothing is scanned yet); dots: scene hidden, only the green/red occlusion dots
  const nextId = useRef(1), gen = useRef(0);
  const guideOn = useOccGuide((g) => g.on);

  // this tab works in the Room, the Workshop and the Street; the SLAM city district is not one of them
  useEffect(() => { if (s.sceneId === 'D') s.setScene('A'); }, [s.sceneId]); // eslint-disable-line react-hooks/exhaustive-deps
  // a new environment invalidates everything placed or scanned in the old one
  useEffect(() => {
    gen.current++;
    setEx(mk(0, scene.defaultPose.x, scene.defaultPose.y, z0, 'tls', scene.defaultPose.yaw));
    setDraft([]); setSaved({ A: [], B: [] }); setSel(null); setScans({}); setShowScans(false); setBusy(false);
    setChal((c) => (c && c.scene === sceneId ? c : null));
  }, [sceneId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const st = useLab.getState(), prev = st.view.sceneOpacity; st.setView({ sceneOpacity: 0.35 }); return () => { useLab.getState().setView({ sceneOpacity: prev }); useLab.getState().patch({ interaction: 'select' }); useOccGuide.getState().close(); }; }, []);
  useEffect(() => { s.patch({ interaction: tool && !guideOn && act !== 'compare' ? 'add-station' : 'select' }); }, [tool, guideOn, act]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = draft;
  const setList = (f: (l: Scanner[]) => Scanner[]) => setDraft(f);
  const selected = list.find((q) => q.id === sel) ?? null;
  const maxN = chal ? chal.maxScanners : MAX_SCANNERS;
  const presetFor = () => (chal ? chal.preset : list[list.length - 1]?.preset ?? 'tls');

  function invalid(x: number, y: number, z: number): string | null {
    const b = scene.bounds;
    if (x < b.min[0] + 0.2 || x > b.max[0] - 0.2 || y < b.min[1] + 0.2 || y > b.max[1] - 0.2) return 'That spot is outside the environment.';
    return insideSolid(scene, x, y, z) ? 'That spot is inside an object. Try an open place.' : null;
  }
  function place(x: number, y: number) {
    if (act === 'compare') return; // Compare only looks at what was saved from Design
    if (act === 'explore') { const e = invalid(x, y, ex.z); if (e) return s.notify(e, 'warn'); setEx((q) => ({ ...q, x, y })); return; }
    if (selected && !(addMode.current)) { const e = invalid(x, y, selected.z); if (e) return s.notify(e, 'warn'); setList((l) => l.map((q) => (q.id === selected.id ? { ...q, x, y } : q))); return; }
    if (list.length >= maxN) return s.notify(`At most ${maxN} scanners${chal ? ' in this challenge' : ''}. Select one and click to move it, or delete one.`, 'warn');
    const z = chal ? chal.height : list[0]?.z ?? z0, e = invalid(x, y, z); if (e) return s.notify(e, 'warn');
    const id = nextId.current++;
    setList((l) => [...l, mk(id, x, y, z, presetFor(), facing(scene, x, y))]); setSel(id); addMode.current = false;
  }
  const addMode = useRef(false);
  useEffect(() => { if (s.pendingStation && !guideOn) { place(s.pendingStation[0], s.pendingStation[1]); s.patch({ pendingStation: null }); } }, [s.pendingStation]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchSel = (p: Partial<Scanner>) => { if (act === 'explore') setEx((q) => ({ ...q, ...p })); else if (selected) setList((l) => l.map((q) => (q.id === selected.id ? { ...q, ...p } : q))); };
  const cur = act === 'explore' ? ex : selected;

  // ---- what to show: the student's own work, or a scripted step of the walkthrough
  const dEx = useDebounced(ex, 140), dDraft = useDebounced(draft, 140);
  const g = useOccGuide();
  const demo = useMemo(() => (guideOn ? demoPlan(scene, 'tls') : null), [guideOn, scene]);
  const q = (v: number, n = 12) => Math.round(v * n) / n;
  const gScan = (st: number, p: number): { act: Act; list: Scanner[]; mode: Mode } | null => {
    if (!demo) return null;
    const S = (o: { x: number; y: number }, i = 0, pr = 'tls') => mk(i, o.x, o.y, demo.z, pr, facing(scene, o.x, o.y));
    if (st === 0) return { act: 'explore', list: [S(demo.poor)], mode: 'heat' };
    if (st === 1) { const f = q(p); return { act: 'explore', list: [S({ x: demo.poor.x + (demo.good.x - demo.poor.x) * f, y: demo.poor.y + (demo.good.y - demo.poor.y) * f })], mode: 'heat' }; }
    if (st === 2) return { act: 'explore', list: [S(demo.good, 0, 'rot16')], mode: 'heat' };
    if (st === 3) return { act: 'design', list: p > 0.3 ? [S(demo.good, 0), S(demo.second, 1)] : [S(demo.good, 0)], mode: 'unique' };
    return { act: 'design', list: [S(demo.good, 0), S(demo.second, 1)], mode: 'heat' };
  };
  const gv = guideOn ? gScan(g.step, g.progress) : null;
  const vAct = gv?.act ?? act;
  const exList = gv ? gv.list : [dEx];
  const exEval = useMemo(() => evaluate(scene, exList), [scene, JSON.stringify(exList)]); // eslint-disable-line react-hooks/exhaustive-deps
  const evA = useMemo(() => evaluate(scene, saved.A), [scene, saved.A]), evB = useMemo(() => evaluate(scene, saved.B), [scene, saved.B]), evDraft = useMemo(() => evaluate(scene, dDraft), [scene, dDraft]);
  const evSlot = gv ? exEval : evDraft;
  const dispList: Scanner[] = gv ? gv.list : vAct === 'explore' ? [ex] : list;
  const vMode = gv?.mode ?? mode;
  const selId = gv ? (gv.mode === 'unique' ? 1 : null) : vAct === 'explore' ? ex.id : sel;

  const colours = useMemo(() => {
    const e = vAct === 'explore' ? exEval : evSlot, n = e.samples.count;
    if (vAct === 'explore') return paint(n, (i) => STATUS_COLOURS[e.status[0][i]]);
    const t = e.stats.times;
    if (vMode === 'owner') return paint(n, (i) => { const j = e.status.findIndex((s2) => s2[i] === SEEN); return j < 0 ? NEUTRAL : STATION_COLOURS[j]; });
    if (vMode === 'unique') { const k = Math.max(0, dispList.findIndex((d) => d.id === selId)); return paint(n, (i) => (t[i] === 0 ? HEAT[0] : t[i] === 1 && e.status[k]?.[i] === SEEN ? STATION_COLOURS[k] : NEUTRAL)); }
    return paint(n, (i) => HEAT[Math.min(2, t[i])]);
  }, [vAct, exEval, evSlot, vMode, selId]); // eslint-disable-line react-hooks/exhaustive-deps
  const diffColours = useMemo(() => paint(evA.samples.count, (i) => { const a = evA.stats.times[i] > 0, b = evB.stats.times[i] > 0; return a && b ? HEAT[2] : b ? HEAT[1] : a ? HEAT[0] : NEUTRAL; }), [evA, evB]);
  const heatB = useMemo(() => paint(evB.samples.count, (i) => HEAT[Math.min(2, evB.stats.times[i])]), [evB]);
  const heatA = useMemo(() => paint(evA.samples.count, (i) => HEAT[Math.min(2, evA.stats.times[i])]), [evA]);
  const cmp = useMemo(() => compareArrangements(evA.samples, evA.stats, evB.stats), [evA, evB]);

  const rayScanner = vAct === 'explore' ? exList[0] : dispList.find((d) => d.id === selId) ?? null;
  const fan = useMemo(() => (rayScanner ? rayFan(scene, rayScanner, sensorOf(rayScanner.preset), 120, Math.min(6, Math.max(1, sensorOf(rayScanner.preset).channels))) : null), [scene, rayScanner?.x, rayScanner?.y, rayScanner?.z, rayScanner?.yaw, rayScanner?.pitch, rayScanner?.preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const scannerSensor = (sc: Scanner) => sensorOf(sc.preset);
  const reach = Math.hypot(scene.bounds.max[0] - scene.bounds.min[0], scene.bounds.max[1] - scene.bounds.min[1]) * 0.45;

  // ---- scanning with the real simulator (individual or all stations)
  const keyOf = (sc: Scanner) => `${sceneId}|${sc.preset}|${[sc.x, sc.y, sc.z, sc.yaw, sc.pitch].map((v) => v.toFixed(3)).join(',')}`;
  async function scan(which: Scanner[]) {
    const my = gen.current; setBusy(true);
    try {
      for (const sc of which) {
        s.patch({ busy: `Scanning with scanner ${list.findIndex((l) => l.id === sc.id) + 1}…` });
        const r = await runTask('scan', { scene, sensor: sensorOf(sc.preset), trajectory: staticPose(sc.x, sc.y, sc.z, sc.yaw, sc.pitch), sweeps: 1, seed: 90 + sc.id, maxRays: 90000, distortion: false, scanId: sc.id, name: `Scanner ${sc.id}` });
        if (my !== gen.current) return;
        setScans((m) => ({ ...m, [sc.id]: { cloud: r.cloud, key: keyOf(sc) } }));
      }
      setShowScans(true);
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { s.patch({ busy: null }); setBusy(false); }
  }
  const fresh = (sc: Scanner) => scans[sc.id]?.key === keyOf(sc);
  const scanClouds = list.map((sc, i) => (scans[sc.id] && fresh(sc) ? { sc, i, cloud: scans[sc.id].cloud } : null)).filter(Boolean) as { sc: Scanner; i: number; cloud: PointCloud }[];

  const ch = chal ? evaluateChallenge(chal, list.length, evSlot.stats) : null;
  function startChallenge(c: Challenge) {
    setChal(c); setAct('design'); setSel(null); setScans({}); setShowScans(false);
    if (sceneId !== c.scene) s.setScene(c.scene); // the environment effect resets the scanners
    else setDraft([]);
    addMode.current = false; setTool(true);
  }
  function showSolution() { if (!chal) return; setDraft(chal.reference.map((p, i) => mk(nextId.current++ + i * 0, p.x, p.y, chal.height, chal.preset, facing(scene, p.x, p.y)))); setSel(null); }

  // ---- 3D views
  const markersFor = (l: Scanner[], selectedId: number | null) => <ScannerMarkers scanners={l} selected={selectedId} sensorOf={scannerSensor} />;
  const sceneBlock = (l: Scanner[], e: ReturnType<typeof evaluate>, col: Float32Array, selectedId: number | null, showRays: boolean) => (
    <>
      {!pointsOnly && <SceneFromStore interactive={true} />}
      {(showVis || look === 'dots') && !(look === 'cloud' && showScans && vAct === 'design' && scanClouds.length > 0) && <SamplePoints samples={e.samples} colours={col} size={Math.max(3, s.view.pointSize)} onlySeenHidden={look === 'dots' && vAct === 'explore' ? e.status[0] : undefined} />}
      {markersFor(l, selectedId)}
      {showFov && l.map((sc, i) => <FovVolume key={sc.id} sc={sc} sensor={sensorOf(sc.preset)} color={STATION_COLOURS[i % 4]} reach={reach} opacity={sc.id === selectedId ? 0.12 : 0.05} />)}
      {showRays && beams !== 'hide' && fan && rayScanner && <RaySweep origin={[rayScanner.x, rayScanner.y, rayScanner.z]} ends={fan.ends} hit={fan.hit} animate={animate} />}
      {(showScans || look === 'cloud') && look !== 'dots' && vAct !== 'explore' && scanClouds.map(({ cloud, i }) => <CloudLayer key={i} cloud={cloud} mode="flat" colorOpts={{ flat: hexRgb(STATION_COLOURS[i % 4]) }} size={Math.max(2, s.view.pointSize - 1)} budget={90000} pickable={false} />)}
    </>
  );
  const home = scene.cameraHome, target = scene.cameraTarget;
  const viewport = vAct === 'compare' && !gv ? (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, background: '#d9d9de' }}>
      <div style={{ position: 'relative' }}><Viewport id="o-a" group="occ" primary bgOverride={pointsOnly ? '#ffffff' : undefined} hideGrid={pointsOnly} home={home} target={target} label={`Arrangement A · ${pct(evA.stats.coverage)} observed`} labelPos="tl" hideAxes>{sceneBlock(saved.A, evA, heatA, null, false)}</Viewport></div>
      <div style={{ position: 'relative' }}><Viewport id="o-b" group="occ" primary={false} bgOverride={pointsOnly ? '#ffffff' : undefined} hideGrid={pointsOnly} home={home} target={target} label={`Arrangement B · ${pct(evB.stats.coverage)} observed`} labelPos="tl" hideAxes>{sceneBlock(saved.B, evB, showDiff ? diffColours : heatB, null, false)}</Viewport></div>
    </div>
  ) : (
    <Viewport home={home} target={target} hideAxes={true} bgOverride={pointsOnly ? '#ffffff' : undefined} hideGrid={pointsOnly}>{sceneBlock(dispList, vAct === 'explore' ? exEval : evSlot, colours, selId, vAct === 'explore' || selId !== null)}</Viewport>
  );

  // ---- numbers
  const shares = useMemo(() => statusShares(exEval.samples, exEval.status[0] ?? new Uint8Array(exEval.samples.count)), [exEval]);
  const stats = vAct === 'explore'
    ? [{ k: 'Visible', v: pct(shares.seen), s: 'surface the laser can reach' }, { k: 'Hidden', v: pct(shares.hidden), s: 'behind something' }, { k: 'Outside field of view', v: pct(shares.outFov) }, { k: 'Too far', v: pct(shares.outRange) }]
    : vAct === 'design'
      ? [{ k: 'Scanners', v: `${dispList.length} / ${maxN}` }, { k: 'Observed', v: pct(evSlot.stats.coverage), s: 'by at least one scanner' }, { k: 'Seen twice or more', v: pct(evSlot.stats.overlap) }, { k: 'Unobserved', v: pct(evSlot.stats.unobserved) }]
      : [{ k: 'A: observed', v: pct(evA.stats.coverage), s: `${evA.stats.scanners} scanner${evA.stats.scanners === 1 ? '' : 's'}` }, { k: 'B: observed', v: pct(evB.stats.coverage), s: `${evB.stats.scanners} scanner${evB.stats.scanners === 1 ? '' : 's'}` }, { k: 'B − A', v: `${cmp.delta >= 0 ? '+' : ''}${(cmp.delta * 100).toFixed(1)} pts`, s: 'change in coverage' }, { k: 'B sees, A does not', v: pct(cmp.gained, 1) }];

  // ---- 2D plan: where things stand, and what is seen from above (the wall and furniture sides at working height)
  const planPts = useMemo(() => {
    const e = vAct === 'explore' ? exEval : evSlot, n = e.samples.count, groups: number[][] = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      const zz = e.samples.pos[i * 3 + 2];
      if (zz < 0.2 || zz > 2.4 || Math.abs(e.samples.normal[i * 3 + 2]) > 0.5) continue;
      groups[vAct === 'explore' ? e.status[0][i] : Math.min(2, e.stats.times[i])].push(e.samples.pos[i * 3], e.samples.pos[i * 3 + 1], zz);
    }
    const cols = vAct === 'explore' ? STATUS_COLOURS : HEAT;
    return groups.map((g2, k) => ({ pos: Float32Array.from(g2), count: g2.length / 3, color: cols[k] ?? '#000', stride: 1 }));
  }, [vAct, exEval, evSlot]);
  const planLayers = {
    points: planPts.filter((p) => p.count > 0),
    markers: dispList.map((sc, i) => ({ x: sc.x, y: sc.y, color: STATION_COLOURS[i % 4], label: `${i + 1}`, yaw: sc.yaw, r: sc.id === selId ? 8 : 5 })),
    fov: cur ? { x: cur.x, y: cur.y, yaw: cur.yaw, hFov: sensorOf(cur.preset).hFov, range: Math.min(sensorOf(cur.preset).maxRange, reach), color: STATION_COLOURS[Math.max(0, dispList.findIndex((d) => d.id === cur.id)) % 4] } : undefined,
  };
  const onPlan = (x: number, y: number) => {
    if (guideOn) return;
    if (act !== 'explore') { const near = list.map((sc, i) => ({ sc, d: Math.hypot(sc.x - x, sc.y - y) })).sort((a, b) => a.d - b.d)[0]; if (near && near.d < 0.9 && !addMode.current) { setSel(near.sc.id); return; } }
    place(x, y);
  };

  // ---- controls
  const presetGroups = PRESET_GROUPS.map((gname) => ({ label: gname, options: PRESETS.filter((p) => p.group === gname).map((p) => ({ value: p.id, label: p.name })) })).filter((x) => x.options.length);
  const editor = cur && (
    <>
      {chal && act !== 'explore' ? <p className="hint">Sensor for this challenge: <b>{sensorOf(chal.preset).name}</b>.</p> : <Select label="Sensor" value={cur.preset} groups={presetGroups} options={[]} onChange={(v) => patchSel({ preset: v })} />}
      <Slider label="Height" value={cur.z} min={0.3} max={4} step={0.1} unit=" m" format={(v) => v.toFixed(1)} disabled={!!chal && act !== 'explore'} onChange={(z) => patchSel({ z })} />
      <Slider label="Turn" value={Math.round(cur.yaw / D2R)} min={-180} max={180} step={5} unit="°" onChange={(v) => patchSel({ yaw: v * D2R })} hint="Which way the scanner faces. A 360° scanner does not care; a narrow one does." />
      <Slider label="Tilt up (+) / down (−)" value={Math.round(-cur.pitch / D2R)} min={-60} max={60} step={5} unit="°" onChange={(v) => patchSel({ pitch: -v * D2R })} />
    </>
  );
  const legend = vAct === 'explore'
    ? STATUS_LABELS.map((l, i) => ({ color: STATUS_COLOURS[i], label: l })).slice(0, look === 'dots' ? 2 : 4)
    : vAct === 'compare' && showDiff && !gv ? [{ color: HEAT[1], label: 'B sees it, A did not' }, { color: HEAT[0], label: 'A saw it, B does not' }, { color: HEAT[2], label: 'Both see it' }, { color: NEUTRAL, label: 'Neither' }]
    : vMode === 'owner' ? [...dispList.map((_, i) => ({ color: STATION_COLOURS[i], label: `Seen by scanner ${i + 1}` })), { color: NEUTRAL, label: 'Not seen' }]
    : vMode === 'unique' ? [{ color: STATION_COLOURS[Math.max(0, dispList.findIndex((d) => d.id === selId))], label: 'Only this scanner sees it' }, { color: NEUTRAL, label: 'Others see it too' }, { color: HEAT[0], label: 'Nobody sees it' }]
    : [{ color: HEAT[0], label: 'Not observed' }, { color: HEAT[1], label: 'One scanner' }, { color: HEAT[2], label: 'Two or more (overlap)' }];

  const guideSteps: GuideStep[] = [
    { title: 'What is occlusion?', text: <>A laser travels in a straight line. It stops at the <b>first</b> thing it hits. Anything behind that is in the <b>shadow</b> and is never measured. <b style={{ color: '#ff453a' }}>Red</b> dots are in a shadow.</>, tech: 'The test is one ray from the scanner to each surface sample: if it hits another object first (or the surface faces away), the sample is hidden.' },
    { title: 'Why does placement matter?', text: <>The scanner slides to a new spot. The shadows move, and surfaces that were hidden are now <b style={{ color: '#30d158' }}>visible</b>.</>, tech: 'Same room, same sensor. Only the position changes, and the hidden share changes with it.' },
    { title: 'Blind spots', text: <>Three things leave a surface unseen: something in the way (<b style={{ color: '#ff453a' }}>red</b>), a direction the sensor does not look (<b style={{ color: '#af52de' }}>pale violet</b>), or a distance it cannot reach (pale grey).</>, tech: 'Now a Velodyne Puck: it sees all around but only ±15° up and down, so the ceiling and the floor near it fall outside its field of view.' },
    { title: 'Use more than one scanner', text: <>A second scanner stands where the first one is blind. <span style={{ color: STATION_COLOURS[1] }}>Its colour</span> shows the surface only it can see.</>, tech: 'Coverage = share of surface area seen by at least one scanner.' },
    { title: 'A good setup', text: <>Each new scanner adds less than the one before. Some <b style={{ color: '#0a84ff' }}>overlap</b> is good, because it lets scans be joined together later. Aim for enough coverage with as few scanners as you can.</>, tech: 'Overlap = share of surface seen by two or more scanners. Too little overlap makes registration hard (see TLS Scanning); too much wastes time.' },
  ];

  const controls = (
    <>
      {guideOn ? (
        <GuidePanel store={useOccGuide} testId="occ-guide" title="How it works" steps={guideSteps}>
          {g.step === 4 && demo && <ConvergenceChart testId="occ-guide-chart" values={demo.curve.map((c) => c * 100)} current={Math.min(1, demo.curve.length - 1)} label="number of scanners (1 to 4, best places)" unit="% observed" color="#0a84ff" />}
          {g.step <= 2 && <div className="caption" data-testid="occ-guide-hidden">Hidden from this scanner: <b>{pct(shares.hidden)}</b> · visible {pct(shares.seen)}</div>}
          {g.step === 3 && <div className="caption" data-testid="occ-guide-cov">Observed: <b>{pct(evSlot.stats.coverage)}</b> with {dispList.length} scanner{dispList.length === 1 ? '' : 's'}</div>}
        </GuidePanel>
      ) : (
        <Section title="How it works">
          <p className="hint">A 5-step walkthrough: what a shadow is, why position matters, and why one scanner is not enough.</p>
          <Btn variant="primary" icon={<Play size={16} />} onClick={() => useOccGuide.getState().start()} testId="occ-guide-start">Start the walkthrough</Btn>
        </Section>
      )}
      <Section title="Activity">
        <Seg value={act} onChange={(v) => { setAct(v); if (v !== 'explore') setTool(true); }} label="Activity" options={[{ value: 'explore', label: 'A · Explore' }, { value: 'design', label: 'B · Design' }, { value: 'compare', label: 'C · Compare' }]} />
      </Section>
      {act === 'compare' && (
        <Section title="Compare two placements">
          <p className="hint">This tab only compares. Build placements in Design and press <b>Save here</b> under A or B.</p>
          {(['A', 'B'] as const).map((k) => <div key={k} className="hint"><b>{k}</b> · {saved[k].length ? `${saved[k].length} scanner${saved[k].length === 1 ? '' : 's'}` : 'nothing saved yet'}</div>)}
          <Toggle label="Show what B changes (right view)" checked={showDiff} onChange={setShowDiff} />
          <Toggle label="Show the field of view" checked={showFov} onChange={setShowFov} />
          <Toggle label="Colour the surfaces" checked={showVis} onChange={setShowVis} />
          <Btn onClick={() => setAct('design')} testId="occ-back-design">Back to Design</Btn>
        </Section>
      )}
      {act !== 'compare' && <Section title="Plan view" hint="Click to place or move. Dots are walls and furniture sides at working height.">
        <Plan2D scene={scene} height={230} onClick={onPlan} layers={planLayers} />
      </Section>}
      {act === 'explore' && (
        <Section title="Explore occlusion">
          <Callout kind="edu" title="Where can the laser not go?">Move the scanner. The dots on the surfaces show what it can reach. Walls and furniture throw <b>shadows</b>.</Callout>
          <Btn sm variant={tool ? 'primary' : ''} icon={<Crosshair size={15} />} onClick={() => setTool((v) => !v)} testId="occ-move-tool">{tool ? 'Click the scene or plan to move it' : 'Move the scanner by clicking'}</Btn>
          {editor}
          <Toggle label="Show the field of view" checked={showFov} onChange={setShowFov} />
          <Toggle label="Colour the surfaces" checked={showVis} onChange={setShowVis} />
          <p className="hint">Orange dots are laser hits. Faint lines that stop in the air are beams that hit nothing within range.</p>
        </Section>
      )}
      {act === 'design' && (
        <Section title="Design the placement">
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <Btn sm variant={tool && (!selected || addMode.current) ? 'primary' : ''} icon={<Plus size={15} />} onClick={() => { addMode.current = true; setTool(true); setSel(null); }} disabled={list.length >= maxN} testId="occ-add">Add scanner</Btn>
            <Btn sm icon={<Trash2 size={15} />} onClick={() => { if (selected) { setList((l) => l.filter((x) => x.id !== selected.id)); setSel(null); setScans((m) => { const c = { ...m }; delete c[selected.id]; return c; }); } }} disabled={!selected} testId="occ-delete">Delete</Btn>
            <Btn sm onClick={() => { setList(() => []); setSel(null); setScans({}); }} disabled={!list.length} testId="occ-clear">Clear</Btn>
          </div>
          <p className="hint">{list.length < maxN ? `Press Add scanner, then click the scene or the plan (up to ${maxN}). ` : `Maximum of ${maxN} scanners. `}Click a scanner on the plan, or its number below, to select it. With one selected, a click moves it.</p>
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>{list.map((sc, i) => <button key={sc.id} className="btn sm" aria-pressed={sc.id === sel} onClick={() => { setSel(sc.id); addMode.current = false; }} data-testid={`occ-pick-${i + 1}`} style={{ borderColor: STATION_COLOURS[i], borderWidth: 2, borderStyle: 'solid', fontWeight: sc.id === sel ? 700 : 500 }}>Scanner {i + 1}</button>)}</div>
          {editor}
          {act === 'design' && <Seg value={mode} onChange={setMode} label="Colour by" options={[{ value: 'heat', label: 'How many see it' }, { value: 'owner', label: 'Which scanner' }]} />}
          <Toggle label="Show the field of view" checked={showFov} onChange={setShowFov} />
          <Toggle label="Colour the surfaces" checked={showVis} onChange={setShowVis} />
        </Section>
      )}
      {act === 'design' && (
        <Section title="Add to compare">
          <p className="hint">Happy with a placement? Save it as A or B, build another, then open Compare to see them side by side.</p>
          {(['A', 'B'] as const).map((k) => {
            const ev = k === 'A' ? evA : evB, n = saved[k].length;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ width: 16 }}>{k}</b>
                <span className="hint" style={{ flex: 1, minWidth: 90 }} data-testid={`occ-saved-${k}`}>{n ? `${n} scanner${n === 1 ? '' : 's'} · ${pct(ev.stats.coverage)} observed` : 'empty'}</span>
                <Btn sm onClick={() => { setSaved((a) => ({ ...a, [k]: list.map((x) => ({ ...x })) })); s.notify(`Saved as ${k}.`, 'info'); }} disabled={!list.length} testId={`occ-save-${k}`}>Save here</Btn>
                <Btn sm onClick={() => { setDraft(saved[k].map((x) => ({ ...x }))); setSel(null); }} disabled={!n} testId={`occ-load-${k}`}>Edit</Btn>
              </div>
            );
          })}
          <Btn variant="primary" onClick={() => setAct('compare')} disabled={!saved.A.length || !saved.B.length} testId="occ-open-compare">Open Compare</Btn>
        </Section>
      )}
      {act === 'design' && list.length > 0 && (
        <Section title="Scan and compare">
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <Btn sm icon={<Play size={15} />} onClick={() => selected && scan([selected])} disabled={!selected || busy} testId="occ-scan-one">Scan this one</Btn>
            <Btn sm variant="primary" icon={<Play size={15} />} onClick={() => scan(list)} busy={busy} testId="occ-scan-all">Scan all</Btn>
          </div>
          <Toggle label="Show the scanned points" checked={showScans} onChange={setShowScans} />
          {list.some((sc) => scans[sc.id] && !fresh(sc)) && <p className="hint" data-testid="occ-stale">A scan is out of date because its scanner moved. Scan again.</p>}
          <table className="table" data-testid="occ-table"><thead><tr><td>Scanner</td><td>Sees</td><td>Only it sees</td><td>Scan</td></tr></thead><tbody>
            {list.map((sc, i) => <tr key={sc.id}><td><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: STATION_COLOURS[i], marginRight: 6 }} />{i + 1}</td><td className="mono">{pct(evSlot.stats.perScanner[i]?.seen ?? 0)}</td><td className="mono">{pct(evSlot.stats.perScanner[i]?.unique ?? 0, 1)}</td><td>{scans[sc.id] ? (fresh(sc) ? `${scans[sc.id].cloud.count.toLocaleString()} pts` : 'old') : '—'}</td></tr>)}
          </tbody></table>
          <p className="hint">“Sees” is geometry: the share of the surface the scanner can reach. A scan also needs enough points on it; that is a different question.</p>
        </Section>
      )}
      {act === 'compare' && (
        <Section title="Before and after">
          <table className="table" data-testid="occ-compare"><thead><tr><td></td><td>A</td><td>B</td></tr></thead><tbody>
            <tr><td>Scanners</td><td className="mono">{evA.stats.scanners}</td><td className="mono">{evB.stats.scanners}</td></tr>
            <tr><td>Observed</td><td className="mono">{pct(evA.stats.coverage, 1)}</td><td className="mono">{pct(evB.stats.coverage, 1)}</td></tr>
            <tr><td>Seen by 2+</td><td className="mono">{pct(evA.stats.overlap, 1)}</td><td className="mono">{pct(evB.stats.overlap, 1)}</td></tr>
            <tr><td>Unobserved</td><td className="mono">{pct(evA.stats.unobserved, 1)}</td><td className="mono">{pct(evB.stats.unobserved, 1)}</td></tr>
          </tbody></table>
          <p className="hint" data-testid="occ-improvement">{evA.stats.scanners === 0 || evB.stats.scanners === 0 ? 'Save a placement as A and another as B in Design first.' : cmp.delta > 0.0005 ? `B observes ${(cmp.gained * 100).toFixed(1)} % of the surface that A missed${cmp.lost > 0.0005 ? ` but loses ${(cmp.lost * 100).toFixed(1)} %` : ''}: +${(cmp.delta * 100).toFixed(1)} points.` : cmp.delta < -0.0005 ? `B is worse by ${(-cmp.delta * 100).toFixed(1)} points.` : 'No change in coverage.'}</p>
        </Section>
      )}
      {act === 'design' && (
        <Section title="Challenges">
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>{CHALLENGES.map((c) => <Btn key={c.id} sm variant={chal?.id === c.id ? 'primary' : ''} onClick={() => startChallenge(c)} testId={`occ-challenge-${c.id}`}>{c.level}</Btn>)}</div>
          {chal && ch ? (
            <div style={{ display: 'grid', gap: 6 }} data-testid="occ-challenge">
              <b>{chal.level}: {chal.title}</b>
              <span className="hint">{chal.goal} Sensor: {sensorOf(chal.preset).name}.</span>
              <div style={{ height: 10, borderRadius: 6, background: 'var(--fill)', overflow: 'hidden' }}><div data-testid="occ-challenge-bar" style={{ width: `${ch.progress * 100}%`, height: '100%', background: ch.done ? '#30d158' : '#0a84ff', transition: 'width .3s' }} /></div>
              <span className="caption mono" data-testid="occ-challenge-progress">{pct(ch.coverage, 1)} of {pct(ch.target)} · scanners {ch.used} / {chal.maxScanners}</span>
              {ch.done ? <Callout kind="good" title="Done">You reached the target with {ch.used} scanner{ch.used === 1 ? '' : 's'}. Can you do it with one fewer?</Callout>
                : <div className="hint" data-testid="occ-advice">{advice(chal, evSlot.stats).map((a2, i) => <div key={i}>• {a2}</div>)}</div>}
              <div className="btn-row"><Btn sm onClick={() => { setList(() => []); setSel(null); }} testId="occ-retry">Retry</Btn><Btn sm onClick={showSolution}>Show an example</Btn><Btn sm onClick={() => setChal(null)}>End challenge</Btn></div>
            </div>
          ) : <p className="hint">Three goals with a limited number of scanners: Easy (Room), Medium (Workshop), Hard (Street).</p>}
        </Section>
      )}
      <GuideClock store={useOccGuide} dur={(st) => (st.step === 1 ? 4000 : st.step === 3 ? 3000 : 2500)} onDone={(st) => { if (st.step < 4) st.goto(st.step + 1); else st.pause(); }} />
    </>
  );

  return <TabFrame title="Occlusion & Sensor Placement" tab={4} viewport={viewport} controls={controls} learn={null} noPanelTabs envIds={['A', 'B', 'C']} stats={stats} overlays={<KindLegend items={legend} top={124} />}
    viewExtras={<>{vAct !== 'compare' && <Seg block={false} value={beams} onChange={setBeams} label="Laser beams" options={[{ value: 'play', label: <><Play size={13} /> Play</> }, { value: 'pause', label: <><Pause size={13} /> Pause</> }, { value: 'hide', label: <><EyeOff size={13} /> Hide</> }]} />}<Seg block={false} value={look} onChange={setLook} label="View" options={[{ value: 'scene', label: <><Boxes size={13} /> Scene</> }, { value: 'cloud', label: <><Dots size={13} /> Point cloud</> }, { value: 'dots', label: <><Circle size={13} /> Coverage</> }]} /></>} />;
}

function hexRgb(h: string): [number, number, number] { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
