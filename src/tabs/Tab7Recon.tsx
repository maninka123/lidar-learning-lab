import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, NumberField, Badge, fmtN } from '../ui/controls';
import { KindLegend, DisplaySection } from '../ui/shared';
import { CloudLayer, SceneLayer, MeshLayer } from '../ui/three';
import { Play, Upload } from '../ui/icons';
import { runTask } from '../engine/client';
import { reconScene, ReconMethod, ReconObjectId } from '../recon/recon';
import { PointCloud } from '../core/pointcloud';
import { applySim } from '../registration/icp';
import { turbo } from '../core/colorize';
import { loadFile } from '../io/load';

const METHODS: { value: ReconMethod | 'external'; label: string }[] = [
  { value: 'photogrammetry', label: 'Multi-view photogrammetry' },
  { value: 'rgbd', label: 'RGB-D fusion' },
  { value: 'monocular', label: 'Single image + depth' },
  { value: 'external', label: 'Uploaded AI / NeRF / 3DGS result' },
];

function PhotoCanvas({ photo, width }: { photo: { w: number; h: number; rgb: Uint8ClampedArray }; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = photo.w; cv.height = photo.h;
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(photo.rgb), photo.w, photo.h), 0, 0);
  }, [photo]);
  return <canvas ref={ref} style={{ width, height: (width * photo.h) / photo.w, borderRadius: 10, display: 'block' }} aria-label="Synthetic photograph of the object" />;
}

export default function Tab7() {
  const s = useLab();
  const r = s.recon;
  const setR = (patch: Partial<typeof r>) => useLab.setState({ recon: { ...useLab.getState().recon, ...patch } });
  const [busy, setBusy] = useState<string | null>(null);
  const [method, setMethod] = useState<ReconMethod | 'external'>(r.method);
  const [showGt, setShowGt] = useState(true);
  const [rgbColour, setRgbColour] = useState(true);
  const scene = useMemo(() => reconScene(r.object), [r.object]);
  const fileRef = useRef<HTMLInputElement>(null);

  const out = r.out;
  const recon: PointCloud | null = method === 'external' ? r.ai : out?.cloud ?? null;
  const aligned = r.align?.valid ? r.align : null;
  const reconShown = aligned ? aligned.aligned : recon;

  const meshShown = useMemo(() => {
    if (!out || method === 'external') return null;
    if (!aligned) return out.mesh;
    const p = new Float32Array(out.mesh.positions.length);
    for (let i = 0; i < p.length; i += 3) { const q = applySim(aligned.T, aligned.scale, [out.mesh.positions[i], out.mesh.positions[i + 1], out.mesh.positions[i + 2]]); p[i] = q[0]; p[i + 1] = q[1]; p[i + 2] = q[2]; }
    return { positions: p, indices: out.mesh.indices };
  }, [out, aligned, method]);

  const errCloud = useMemo(() => {
    if (!aligned || !r.cmp) return null;
    const c: PointCloud = { ...aligned.aligned, ranges: r.cmp.reconToLidar as Float32Array };
    return c;
  }, [aligned, r.cmp]);

  async function genLidar() {
    setBusy('Scanning the object with LiDAR…');
    try { const c = await runTask('reconLidar', { object: r.object, seed: r.seed, stations: 2 }); setR({ lidar: c, align: null, cmp: null }); } finally { setBusy(null); }
  }
  async function genRecon() {
    if (method === 'external') { fileRef.current?.click(); return; }
    setBusy('Reconstructing from images…');
    try { const o = await runTask('recon', { params: { object: r.object, method, views: r.views, seed: r.seed } }); setR({ out: o, method, align: null, cmp: null }); } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); }
  }
  async function align() {
    if (!r.lidar || !recon) return;
    setBusy('Aligning (scale + ICP) and measuring…');
    try {
      const res = await runTask('reconCompare', { object: r.object, recon, lidar: r.lidar });
      setR({ align: res.align, cmp: res.cmp });
      if (!res.align.valid) s.notify('Alignment did not converge to a valid fit — error statistics are not reported.', 'warn');
    } finally { setBusy(null); }
  }
  useEffect(() => { if (!r.lidar && !busy) void genLidar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lidarProps = (c: PointCloud) => ({ cloud: c, mode: (rgbColour ? 'rgb' : 'flat') as 'rgb' | 'flat', colorOpts: { flat: [10, 132, 255] as [number, number, number] }, size: Math.max(2, s.view.pointSize - 1), budget: s.view.renderBudget, pickable: false });
  const reconProps = (c: PointCloud, flat = false) => ({ cloud: c, mode: (rgbColour && !flat ? 'rgb' : 'flat') as 'rgb' | 'flat', colorOpts: { flat: [191, 90, 242] as [number, number, number] }, size: Math.max(2, s.view.pointSize - 1), budget: s.view.renderBudget, pickable: false });
  const home: [number, number, number] = [2.4, -2.4, 1.7], target: [number, number, number] = [0, 0, 0.45];

  const content = (which: 'single' | 'lidar' | 'recon') => (
    <>
      {showGt && <SceneLayer scene={scene} opacity={0.18} showCeiling interactive={false} />}
      {(which === 'lidar' || (which === 'single' && (r.layer === 'lidar' || r.layer === 'overlay'))) && r.lidar && <CloudLayer {...lidarProps(r.lidar)} {...(r.layer === 'overlay' ? { mode: 'flat' as const } : {})} />}
      {(which === 'recon' || (which === 'single' && (r.layer === 'recon' || r.layer === 'overlay'))) && reconShown && r.layer !== 'mesh' && r.layer !== 'error' && <CloudLayer {...reconProps(reconShown, r.layer === 'overlay')} />}
      {(which === 'recon' || which === 'single') && r.layer === 'mesh' && meshShown && <MeshLayer mesh={meshShown} />}
      {(which === 'single' && r.layer === 'error' && errCloud) && <CloudLayer cloud={errCloud} mode="range" colorOpts={{ rangeFixed: [0, r.errMax] }} size={Math.max(2, s.view.pointSize - 1)} budget={s.view.renderBudget} pickable={false} />}
      {which === 'recon' && r.layer === 'error' && errCloud && <CloudLayer cloud={errCloud} mode="range" colorOpts={{ rangeFixed: [0, r.errMax] }} size={3} budget={s.view.renderBudget} pickable={false} />}
    </>
  );

  const photoLayer = r.layer === 'photo';
  const viewport = r.layout === 'split' && !photoLayer ? (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      <div style={{ position: 'relative' }}><Viewport id="r-a" group="recon" primary label="LiDAR measurement" home={home} target={target} threshold={0.01} gridSize={0.25}>{content('lidar')}</Viewport></div>
      <div style={{ position: 'relative' }}><Viewport id="r-b" group="recon" primary={false} labelPos="bl" label={aligned ? 'Reconstruction (aligned)' : 'Reconstruction (not aligned)'} home={home} target={target} threshold={0.01} gridSize={0.25}>{content('recon')}</Viewport></div>
    </div>
  ) : photoLayer ? (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#0b0c10' }}>
      {out ? <div style={{ textAlign: 'center' }}><PhotoCanvas photo={out.photo} width={Math.min(720, 560)} /><p className="caption" style={{ marginTop: 8, color: 'var(--text2)' }}>Synthetic photograph rendered by the ray-caster (Lambert shading + procedural wood texture) — the input to the image-based methods.</p></div> : <p className="hint" style={{ color: '#fff' }}>Press “Reconstruct” to render the photograph(s).</p>}
    </div>
  ) : (
    <Viewport home={home} target={target} threshold={0.01} gridSize={0.25}>{content('single')}</Viewport>
  );

  const st = r.cmp?.stats;
  const hid = out?.hiddenTransform;
  const stats = aligned && st
    ? [
      { k: 'Mean error → LiDAR', v: `${(st.accuracyVsLidar.mean * 1000).toFixed(1)} mm`, s: `RMSE ${(st.accuracyVsLidar.rmse * 1000).toFixed(1)} mm · p95 ${(st.accuracyVsLidar.p95 * 1000).toFixed(0)} mm` },
      { k: 'Within 2 / 5 cm', v: `${(st.accuracyVsLidar.within2 * 100).toFixed(0)} / ${(st.accuracyVsLidar.within5 * 100).toFixed(0)} %`, s: 'of reconstructed points' },
      { k: 'Completeness (recon / LiDAR)', v: `${(st.completenessRecon * 100).toFixed(0)} / ${(st.completenessLidar * 100).toFixed(0)} %`, s: 'true surface within 3 cm' },
      { k: 'Alignment', v: `scale ${aligned.scale.toFixed(3)}`, s: `fitness ${(aligned.fitness * 100).toFixed(0)} % · RMSE ${(aligned.rmse * 1000).toFixed(1)} mm` },
    ]
    : [
      { k: 'LiDAR points', v: r.lidar ? fmtN(r.lidar.count) : '—', s: '2 stations' },
      { k: 'Reconstruction', v: recon ? fmtN(recon.count) : '—', s: out ? METHODS.find((m) => m.value === method)?.label : undefined },
      { k: 'Alignment', v: r.align ? (r.align.valid ? 'valid' : 'invalid') : 'not done', s: 'error stats need valid alignment' },
      { k: 'Mesh faces', v: out ? fmtN(out.mesh.indices.length / 3) : '—', s: 'voxel surface' },
    ];

  const obsItems: [keyof typeof r.observations, string, string][] = [
    ['occlusion', 'Occlusion', 'Surfaces hidden from the two LiDAR stations (e.g. under the seat) are missing in the LiDAR cloud.'],
    ['missing', 'Missing geometry', 'Regions with no reconstructed points (back/underside, textureless faces).'],
    ['texture', 'Texture differences', 'Colour comes from the photo for the reconstruction but from the material albedo in the LiDAR scan.'],
    ['geometry', 'Geometric inaccuracies', 'Wavy or offset surfaces in the error map, especially at grazing views or far from the cameras.'],
  ];

  const controls = (
    <>
      <Callout kind="warn" title="What is real here">
        The LiDAR cloud, photograph, depth maps and reconstructions below are all <b>computed in the browser</b> by simulation (ray casting, depth-error models, depth-map fusion). They are not outputs of a real NeRF, Gaussian-splatting or generative model — none are bundled. You can import your own prerecorded result and evaluate it with the same tools.
      </Callout>
      <Section title="Object & method">
        <Select label="Object" value={r.object} options={[{ value: 'chair', label: 'Chair' }, { value: 'crate', label: 'Wooden crate' }]} onChange={(o) => setR({ object: o as ReconObjectId, out: null, lidar: null, align: null, cmp: null })} />
        <Select label="Image-based method" value={method} options={METHODS} onChange={(m) => { setMethod(m); setR({ align: null, cmp: null }); }} />
        {method === 'photogrammetry' && <p className="hint">Several photos → matching → depth fusion. Textureless faces fail, scale is unknown, poses carry small errors.</p>}
        {method === 'rgbd' && <p className="hint">Depth camera with known poses: metric scale and low noise, but limited to what the cameras saw.</p>}
        {method === 'monocular' && <p className="hint">One photo only: depth has unknown scale/shift and smooth distortion, and nothing behind the object exists.</p>}
        {method === 'external' && <p className="hint">Upload a PLY/PCD you produced with NeRF, 3D Gaussian Splatting or an image-to-3D model (export the point cloud / mesh vertices).</p>}
        {(method === 'photogrammetry' || method === 'rgbd') && <Slider label="Number of views" value={r.views} min={2} max={16} step={1} onChange={(views) => setR({ views })} />}
        <NumberField label="Seed" value={r.seed} step={1} onChange={(seed) => setR({ seed: Math.round(seed) || 0 })} />
        <input ref={fileRef} type="file" accept=".ply,.pcd,.las" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { const c = await loadFile(f); c.meta.kind = 'reconstructed'; setR({ ai: c, align: null, cmp: null }); } catch (err) { s.notify((err as Error).message, 'error'); } } e.target.value = ''; }} />
        <div className="btn-row">
          <Btn onClick={genLidar} busy={busy === 'Scanning the object with LiDAR…'} icon={<Play size={16} />}>LiDAR scan</Btn>
          <Btn variant="primary" onClick={genRecon} busy={busy?.startsWith('Reconstructing') ?? false} icon={method === 'external' ? <Upload size={16} /> : <Play size={16} />} testId="reconstruct">{method === 'external' ? 'Upload result…' : 'Reconstruct'}</Btn>
        </div>
      </Section>
      <Section title="Align & measure">
        <Btn variant="primary" onClick={align} disabled={!r.lidar || !recon} busy={busy?.startsWith('Aligning') ?? false} testId="align-recon">Align to LiDAR & compute error</Btn>
        <p className="hint">Similarity ICP (rotation, translation <i>and scale</i>) with a coarse yaw search. Error figures are only shown when the fit is valid.</p>
        {r.align && !r.align.valid && <Callout kind="bad" title="Alignment not valid">Fitness {(r.align.fitness * 100).toFixed(0)} %, RMSE {(r.align.rmse * 100).toFixed(1)} cm — no error statistics are reported. Try more views or another method.</Callout>}
        {aligned && hid && <Callout kind="good" title="Validation (simulation only)">Estimated scale correction {aligned.scale.toFixed(3)} vs true {(1 / hid.scale).toFixed(3)} — the hidden arbitrary scale of the reconstruction was recovered.</Callout>}
        {aligned && <Slider label="Error colour range" value={r.errMax} min={0.01} max={0.2} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(errMax) => setR({ errMax })} />}
      </Section>
      <Section title="View">
        <Seg value={r.layer} onChange={(layer) => setR({ layer })} options={[{ value: 'photo', label: 'Photo' }, { value: 'lidar', label: 'LiDAR' }, { value: 'recon', label: 'Recon' }]} />
        <Seg value={r.layer} onChange={(layer) => setR({ layer })} options={[{ value: 'mesh', label: 'Mesh' }, { value: 'overlay', label: 'Overlay' }, { value: 'error', label: 'Error map' }]} />
        <Seg value={r.layout} onChange={(layout) => setR({ layout })} options={[{ value: 'single', label: 'Single view' }, { value: 'split', label: 'Split · synced orbit' }]} />
        <Toggle label="Reference model (original mesh geometry)" checked={showGt} onChange={setShowGt} />
        <Toggle label="RGB colours (off: one colour per source)" checked={rgbColour} onChange={setRgbColour} />
      </Section>
      {aligned && st && (
        <Section title="Error statistics">
          <table className="table" data-testid="recon-stats"><tbody>
            <tr><td>Reconstruction → LiDAR (mean / RMSE)</td><td className="mono">{(st.accuracyVsLidar.mean * 1000).toFixed(1)} / {(st.accuracyVsLidar.rmse * 1000).toFixed(1)} mm</td></tr>
            <tr><td>Reconstruction → true surface (mean / RMSE)</td><td className="mono">{(st.accuracyVsGroundTruth.mean * 1000).toFixed(1)} / {(st.accuracyVsGroundTruth.rmse * 1000).toFixed(1)} mm</td></tr>
            <tr><td>Completeness: recon / LiDAR</td><td className="mono">{(st.completenessRecon * 100).toFixed(0)} % / {(st.completenessLidar * 100).toFixed(0)} %</td></tr>
            <tr><td>Estimated scale</td><td className="mono">{aligned.scale.toFixed(3)}</td></tr>
          </tbody></table>
          <span className="caption">Valid because: the model was aligned including scale, and ground truth is known (simulated object). With real data, “true surface” is unavailable.</span>
        </Section>
      )}
      <Section title="Observations (tick what you can verify)">
        {obsItems.map(([k, label, hint]) => <Toggle key={k} label={label} checked={r.observations[k]} onChange={(v) => setR({ observations: { ...r.observations, [k]: v } })} hint={hint} />)}
      </Section>
      <DisplaySection />
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="Measured vs inferred">LiDAR measures distance directly. Image-based methods <i>infer</i> depth from appearance: powerful and dense, but they depend on texture, lighting and a scale reference.</Callout>
      <Callout title="Photogrammetry / RGB-D">Photogrammetry matches features across photos and triangulates (scale-free). RGB-D adds a depth sensor. Both produce points or meshes; meshes connect points into surfaces.</Callout>
      <Callout title="NeRF & 3D Gaussian Splatting">Both optimise a scene representation so that rendered views match the photos. NeRF stores a neural radiance field; 3DGS stores millions of 3D Gaussians for fast rendering. They are optimised for <i>appearance</i> — geometry accuracy must be checked, e.g. against LiDAR as here. Their outputs are not simulated in this app.</Callout>
      <Callout title="Generative image-to-3D">Models can hallucinate unseen sides from a single image. Plausible is not the same as measured — always compare with ground truth where possible.</Callout>
      <Callout kind="warn" title="Why alignment matters">Without a common frame and scale, point-to-point distances are meaningless. This tab refuses to report error figures until the alignment is valid.</Callout>
    </>
  );

  return (
    <TabFrame
      title="Image to 3D Reconstruction"
      tab={6}
      viewport={viewport}
      controls={controls}
      learn={learn}
      stats={stats}
      overlays={
        <>
          <KindLegend items={[{ color: '#8e8e93', label: 'Original mesh geometry', style: 'wire' }, { color: '#0a84ff', label: 'LiDAR point cloud (simulated)' }, { color: '#bf5af2', label: 'Reconstructed (image-derived)' }]} />
          {out && !photoLayer && <div className="overlay glass card" style={{ right: 12, bottom: 12, padding: 8 }}><PhotoCanvas photo={out.photo} width={190} /></div>}
          {r.layer === 'error' && aligned && <div className="overlay glass card" style={{ right: 12, top: 70, width: 200 }}><div className="caption">distance to LiDAR</div><div style={{ height: 10, borderRadius: 6, background: `linear-gradient(90deg,${Array.from({ length: 10 }, (_, i) => { const c = turbo(i / 9); return `rgb(${c[0]},${c[1]},${c[2]})`; }).join(',')})` }} /><div style={{ display: 'flex', justifyContent: 'space-between' }} className="mono caption"><span>0</span><span>{(r.errMax * 1000).toFixed(0)} mm</span></div></div>}
          {out && <div className="overlay" style={{ left: 12, top: 150 }}><Badge kind="recon">{METHODS.find((m) => m.value === method)?.label ?? ''}</Badge></div>}
        </>
      }
    />
  );
}
