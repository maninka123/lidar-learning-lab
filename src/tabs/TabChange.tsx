import { useMemo, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Seg, Slider, Toggle } from '../ui/controls';
import { CloudLayer } from '../ui/three';
import { Play } from '../ui/icons';
import { useLab } from '../state/store';
import { useClassroom } from '../apps/useClassroom';
import { makeEpoch2, cloudToCloud, detectChanges, ChangeResult, Epoch2 } from '../apps/change';
import { PointCloud, transformCloud } from '../core/pointcloud';
import { runTask } from '../engine/client';
import { turbo } from '../core/colorize';
import { evaluateAlignment } from '../registration/icp';
import { rigidFromEuler } from '../core/math';
import { Credit } from '../ui/VideoCard';

type Layer = 'scan1' | 'scan2' | 'distance' | 'changes';
const GREY: [number, number, number] = [196, 198, 204];

export default function TabChange() {
  const s = useLab();
  const { cloud: c1 } = useClassroom(0.03);
  const [spec, setSpec] = useState({ move: true, remove: true, add: true, misregister: true });
  const [e2, setE2] = useState<Epoch2 | null>(null);
  const [c2, setC2] = useState<PointCloud | null>(null); // scan 2 after alignment
  const [rms, setRms] = useState<{ before: number; after: number | null } | null>(null);
  const [dists, setDists] = useState<{ dOld: Float32Array; dNew: Float32Array } | null>(null);
  const [thr, setThr] = useState(0.06), [minPts, setMinPts] = useState(80);
  const [res, setRes] = useState<ChangeResult | null>(null);
  const [layer, setLayer] = useState<Layer>('scan1');
  const [hideCeiling, setHideCeiling] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const step = (label: string, fn: () => void | Promise<void>) => { setBusy(label); setTimeout(async () => { try { await fn(); } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); } }, 30); };

  const makeScan2 = () => c1 && step('scan2', () => {
    const r = makeEpoch2(c1, spec, 11);
    setE2(r); setC2(r.cloud); setRes(null); setDists(null);
    const a = evaluateAlignment(r.cloud.positions, r.cloud.count, c1.positions, c1.count, rigidFromEuler(0, 0, 0, 0, 0, 0), 0.3, 4000);
    setRms({ before: a.rmse, after: null }); setLayer('scan2');
  });
  const align = () => e2 && c1 && step('align', async () => {
    const r = await runTask('icp', { src: e2.cloud.positions, nSrc: e2.cloud.count, dst: c1.positions, nDst: c1.count, opts: { maxIterations: 60, tolerance: 1e-7, maxCorrDist: 0.6, sampleMax: 30000, method: 'plane' } });
    const moved = transformCloud(e2.cloud, r.T, 'Scan 2 (aligned)');
    const a = evaluateAlignment(moved.positions, moved.count, c1.positions, c1.count, rigidFromEuler(0, 0, 0, 0, 0, 0), 0.3, 4000);
    setC2(moved); setRms((q) => ({ before: q?.before ?? 0, after: a.rmse })); setDists(null); setRes(null);
  });
  const compare = () => c1 && c2 && e2 && step('compare', () => {
    const d = { dOld: cloudToCloud(c1, c2), dNew: cloudToCloud(c2, c1) };
    setDists(d); setRes(detectChanges(c1, c2, thr, minPts, e2.truth, d)); setLayer('changes');
  });
  const retune = (t: number, m: number) => { setThr(t); setMinPts(m); if (c1 && c2 && e2 && dists) setRes(detectChanges(c1, c2, t, m, e2.truth, dists)); };

  const painted = useMemo(() => {
    const paint = (c: PointCloud, f: (i: number) => [number, number, number]) => { const col = new Uint8Array(c.count * 3); for (let i = 0; i < c.count; i++) col.set(f(i), i * 3); return { ...c, colors: col } as PointCloud; };
    if (!c1) return { a: null as PointCloud | null, b: null as PointCloud | null };
    if (layer === 'scan1') return { a: c1, b: null };
    if (layer === 'scan2') return { a: c2, b: null };
    if (layer === 'distance' && c2 && dists) return { a: paint(c2, (i) => { const t = Math.min(1, dists.dNew[i] / 0.3), c = turbo(t); return [c[0], c[1], c[2]]; }), b: null };
    if (layer === 'changes' && res && c2) return { a: paint(c1, (i) => (res.removed[i] ? [235, 50, 50] : GREY)), b: paint(c2, (i) => (res.added[i] ? [40, 190, 90] : [0, 0, 0])) };
    return { a: c1, b: null };
  }, [layer, c1, c2, dists, res]);
  // only the highlighted points of scan 2 are drawn in the changes view
  const addedOnly = useMemo(() => {
    if (!painted.b || !res || !c2) return null;
    const ids: number[] = []; for (let i = 0; i < c2.count; i++) if (res.added[i]) ids.push(i);
    const pos = new Float32Array(ids.length * 3), col = new Uint8Array(ids.length * 3);
    ids.forEach((j, k) => { pos.set(c2.positions.subarray(j * 3, j * 3 + 3), k * 3); col.set([40, 190, 90], k * 3); });
    return { ...c2, count: ids.length, positions: pos, colors: col, labels: undefined, intensity: undefined, normals: undefined } as PointCloud;
  }, [painted.b, res, c2]);

  const viewport = (
    <Viewport home={[8, -10, 6.5]} target={[0, 0, 1.2]} gridSize={1} hideAxes bgOverride="#ffffff">
      {painted.a && <CloudLayer cloud={painted.a} mode="rgb" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 300000)} pickable={false} clip={{ on: hideCeiling, min: -1, max: 2.28 }} />}
      {addedOnly && <CloudLayer cloud={addedOnly} mode="rgb" size={Math.max(3, s.view.pointSize)} budget={200000} pickable={false} clip={{ on: hideCeiling, min: -1, max: 2.28 }} />}
    </Viewport>
  );
  const nRem = res ? res.removed.reduce((a, v) => a + v, 0) : 0, nAdd = res ? res.added.reduce((a, v) => a + v, 0) : 0;
  const stats = [
    { k: 'Change regions', v: res ? String(res.regions.length) : '—', s: res ? `${e2?.truth.length ?? 0} real changes made` : undefined },
    { k: 'Found / made', v: res ? `${Math.round(res.recall * (e2?.truth.length ?? 0))} of ${e2?.truth.length ?? 0}` : '—', s: res ? `${res.falseRegions} extra region${res.falseRegions === 1 ? '' : 's'}` : undefined },
  ];
  const controls = (
    <>
      <Callout kind="edu" title="What changed between two scans?">
        Scan the same place twice, then compare. For every point in one scan, find the <b>nearest point in the other</b>. If it is far away, nothing was there before (or after). The steps: <b>align</b> the scans, <b>measure distances</b>, apply a <b>threshold</b>, <b>group</b> the changed points into objects.
      </Callout>
      <Section title="1 · Make a second scan">
        <p className="hint">The classroom is scan 1. Scan 2 is the same room after some edits:</p>
        <Toggle label="One object removed" checked={spec.remove} onChange={(remove) => setSpec({ ...spec, remove })} />
        <Toggle label="One object moved" checked={spec.move} onChange={(move) => setSpec({ ...spec, move })} />
        <Toggle label="A new box added" checked={spec.add} onChange={(add) => setSpec({ ...spec, add })} />
        <Toggle label="Scanner position slightly off" checked={spec.misregister} onChange={(misregister) => setSpec({ ...spec, misregister })} hint="Real scans of the same room never line up perfectly. This shifts scan 2 by about 15 cm and 2°." />
        <Btn variant="primary" icon={<Play size={16} />} onClick={makeScan2} busy={busy === 'scan2'} disabled={!c1} testId="make-scan2">Make scan 2</Btn>
      </Section>
      <Section title="2 · Line the scans up">
        <Btn onClick={align} busy={busy === 'align'} disabled={!e2} testId="align-scans">Align with ICP</Btn>
        {rms && <p className="hint">Average gap between the scans: {(rms.before * 100).toFixed(1)} cm{rms.after !== null ? ` → ${(rms.after * 100).toFixed(1)} cm after alignment` : ''}. Compare before aligning to see why this step matters: a shifted scan makes <i>everything</i> look changed.</p>}
      </Section>
      <Section title="3 · Find the changes">
        <Slider label="Change threshold" value={thr * 100} min={1} max={30} step={0.5} unit=" cm" format={(v) => v.toFixed(1)} onChange={(v) => retune(v / 100, minPts)} hint="A point counts as changed if its nearest neighbour in the other scan is farther than this. Too small: noise looks like change. Too large: small changes are missed." />
        <Slider label="Smallest change" value={minPts} min={20} max={400} step={10} unit=" points" onChange={(v) => retune(thr, v)} />
        <Btn variant="primary" onClick={compare} busy={busy === 'compare'} disabled={!c2} testId="find-changes">Find changes</Btn>
      </Section>
      <Section title="Tutorial"><Credit keys={['change']} title="" /></Section>
      <Section title="View">
        <Seg value={layer} onChange={setLayer} options={[{ value: 'scan1', label: 'Scan 1' }, { value: 'scan2', label: 'Scan 2' }]} />
        <Seg value={layer} onChange={setLayer} options={[{ value: 'distance', label: 'Distance' }, { value: 'changes', label: 'Changes' }]} />
        <Toggle label="Hide the ceiling" checked={hideCeiling} onChange={setHideCeiling} />
        {layer === 'changes' && <p className="hint"><b style={{ color: '#eb3232' }}>Red</b>: in scan 1 but gone in scan 2. <b style={{ color: '#28be5a' }}>Green</b>: new in scan 2. Grey: unchanged. A moved object shows up as red at its old place and green at its new one.</p>}
        {layer === 'distance' && <p className="hint">Colour = distance to the nearest point of scan 1: blue 0 cm → red 30 cm.</p>}
      </Section>
      {res && (
        <Section title="4 · What changed">
          <table className="table"><thead><tr><td>Region</td><td>Points</td><td>Size (m)</td><td>Matches</td></tr></thead><tbody>
            {res.regions.slice(0, 10).map((r, i) => (
              <tr key={i}><td><b style={{ color: r.kind === 'removed' ? '#eb3232' : '#28be5a' }}>{r.kind === 'removed' ? 'Gone' : 'New'}</b> · {r.label}</td><td className="mono">{r.points}</td><td className="mono">{r.size.map((v) => v.toFixed(1)).join(' × ')}</td><td>{r.matched ?? <span className="caption">no real change here</span>}</td></tr>
            ))}
          </tbody></table>
          <p className="hint">{nRem.toLocaleString()} points gone, {nAdd.toLocaleString()} new. We know what was changed, so each region is checked against the truth.</p>
        </Section>
      )}
    </>
  );
  return <TabFrame title="Change Detection" tab={13} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv statsRow stats={stats} />;
}
