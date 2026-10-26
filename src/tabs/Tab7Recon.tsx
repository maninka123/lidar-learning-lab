import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, NumberField, Badge, fmtN } from '../ui/controls';
import { CloudLayer, SceneLayer, MeshLayer } from '../ui/three';
import { Play, Upload } from '../ui/icons';
import { runTask } from '../engine/client';
import { reconScene, surfaceMesh, renderView, RECON_SCENES, ReconMethod, ReconObjectId } from '../recon/recon';
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

function PhotoCanvas({ photo, width }: { photo: { w: number; h: number; rgb: Uint8ClampedArray }; width: number | string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = photo.w; cv.height = photo.h;
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(photo.rgb), photo.w, photo.h), 0, 0);
  }, [photo]);
  return <canvas ref={ref} style={{ width, height: 'auto', aspectRatio: `${photo.w} / ${photo.h}`, borderRadius: 10, display: 'block', background: '#e5e5ea' }} aria-label="Synthetic photograph" />;
}

export default function Tab7() {
  const s = useLab();
  const r = s.recon;
  const setR = (patch: Partial<typeof r>) => useLab.setState({ recon: { ...useLab.getState().recon, ...patch } });
  const [busy, setBusy] = useState<string | null>(null);
  const [method, setMethod] = useState<ReconMethod | 'external'>(r.method);
  const [showGt, setShowGt] = useState(false);
  const [pane, setPane] = useState<'scene' | 'build' | 'compare'>('scene');
  const [rgbColour, setRgbColour] = useState(true);
  const scene = useMemo(() => reconScene(r.object), [r.object]);
  const info = RECON_SCENES[r.object];
  // a small photo of every scene for the picker
  const thumbs = useMemo(() => (Object.keys(RECON_SCENES) as ReconObjectId[]).map((id) => {
    const k = RECON_SCENES[id].radius / 2.2;
    const v = renderView(reconScene(id), { pos: [3.6 * k, -3.3 * k, RECON_SCENES[id].centerZ + 1.7 * k], target: [0, 0, RECON_SCENES[id].centerZ], fovDeg: 55 }, 160, 110);
    return { id, photo: { w: v.w, h: v.h, rgb: v.rgb } };
  }), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [meshOpts, setMeshOpts] = useState<{ method: 'voxel' | 'smooth'; voxel: number }>({ method: 'smooth', voxel: 0.03 });
  const [userMesh, setUserMesh] = useState<{ positions: Float32Array; indices: Uint32Array } | null>(null);

  const out = r.out;
  const recon: PointCloud | null = method === 'external' ? r.ai : out?.cloud ?? null;
  const aligned = r.align?.valid ? r.align : null;
  const reconShown = aligned ? aligned.aligned : recon;

  const meshShown = useMemo(() => {
    const base = userMesh ?? (method === 'external' ? null : out?.mesh ?? null);
    if (!base) return null;
    if (!aligned) return base;
    const p = new Float32Array(base.positions.length);
    for (let i = 0; i < p.length; i += 3) { const q = applySim(aligned.T, aligned.scale, [base.positions[i], base.positions[i + 1], base.positions[i + 2]]); p[i] = q[0]; p[i + 1] = q[1]; p[i + 2] = q[2]; }
    return { positions: p, indices: base.indices };
  }, [out, userMesh, aligned, method]);
  useEffect(() => { setUserMesh(null); }, [out, r.ai, method]);
  function buildMesh() {
    if (!recon) { s.notify('Reconstruct (or upload a result) first, then build the surface.', 'warn'); return; }
    setBusy('Building the surface…');
    setTimeout(() => { try { setUserMesh(surfaceMesh(recon, meshOpts)); setR({ layer: 'mesh', layout: 'single' }); } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); } }, 30);
  }

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
    try { const o = await runTask('recon', { params: { object: r.object, method, views: r.views, seed: r.seed } }); setR({ out: o, method, align: null, cmp: null, layer: 'recon', layout: 'single' }); } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); }
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
  useEffect(() => { if (!r.lidar && !busy) void genLidar(); }, [r.object]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickScene = (o: ReconObjectId) => { setR({ object: o, out: null, lidar: null, align: null, cmp: null, ai: null, layer: 'scene', layout: 'single' }); };

  const lidarProps = (c: PointCloud) => ({ cloud: c, mode: (rgbColour ? 'rgb' : 'flat') as 'rgb' | 'flat', colorOpts: { flat: [230, 30, 40] as [number, number, number] }, size: Math.max(2, s.view.pointSize - 1), budget: s.view.renderBudget, pickable: false });
  const reconProps = (c: PointCloud, flat = false) => ({ cloud: c, mode: (rgbColour && !flat ? 'rgb' : 'flat') as 'rgb' | 'flat', colorOpts: { flat: [191, 90, 242] as [number, number, number] }, size: Math.max(2, s.view.pointSize - 1), budget: s.view.renderBudget, pickable: false });
  const home: [number, number, number] = [info.radius * 1.1, -info.radius * 1.1, info.radius * 0.8], target: [number, number, number] = [0, 0, info.centerZ * 0.9];

  const content = (which: 'single' | 'lidar' | 'recon') => (
    <>
      {(showGt || r.layer === 'scene') && <SceneLayer scene={scene} opacity={r.layer === 'scene' ? 1 : 0.18} showCeiling interactive={false} />}
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
      <div style={{ position: 'relative' }}><Viewport id="r-a" group="recon" primary hideGrid hideAxes bgOverride="#ffffff" labelPos="tl" label="LiDAR measurement" home={home} target={target} threshold={0.01} gridSize={0.25}>{content('lidar')}</Viewport></div>
      <div style={{ position: 'relative' }}><Viewport id="r-b" group="recon" primary={false} hideGrid hideAxes bgOverride="#ffffff" labelPos="tl" label={aligned ? 'Reconstruction (aligned)' : 'Reconstruction (not aligned)'} home={home} target={target} threshold={0.01} gridSize={0.25}>{content('recon')}</Viewport></div>
    </div>
  ) : photoLayer ? (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#f5f5f7', padding: '76px 16px 16px' }} data-testid="photo-gallery">
      {out ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {out.photos.map((ph, i) => (
            <figure key={i} style={{ margin: 0, background: '#fff', borderRadius: 14, padding: 8, boxShadow: '0 1px 6px rgba(0,0,0,.08)' }}>
              <PhotoCanvas photo={ph} width="100%" />
              <figcaption className="caption" style={{ padding: '6px 4px 2px', fontWeight: 600 }}>{ph.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : <p className="hint" style={{ textAlign: 'center', paddingTop: 40 }}>Press “Reconstruct” to render the scene image and the photographs the method uses.</p>}
      {out && <p className="caption" style={{ marginTop: 10 }}>Synthetic images rendered by the ray-caster (Lambert shading + a procedural wood texture): one wide shot of the scene, then the photographs or RGB-D frames that the chosen method turns into 3D.</p>}
    </div>
  ) : (
    <Viewport key={r.object} home={home} target={target} threshold={0.01} gridSize={0.25} hideGrid hideAxes bgOverride="#ffffff">{content('single')}</Viewport>
  );

  const st = r.cmp?.stats;
  const hid = out?.hiddenTransform;
  const stats = aligned && st
    ? [
      { k: 'Average error', v: `${(st.accuracyVsLidar.mean * 1000).toFixed(1)} mm`, s: `within 5 cm: ${(st.accuracyVsLidar.within5 * 100).toFixed(0)}% of points` },
      { k: 'Completeness', v: `${(st.completenessRecon * 100).toFixed(0)}% / ${(st.completenessLidar * 100).toFixed(0)}%`, s: 'reconstruction / LiDAR' },
    ]
    : [
      { k: 'LiDAR points', v: r.lidar ? fmtN(r.lidar.count) : '—', s: '2 stations' },
      { k: 'Reconstruction', v: recon ? fmtN(recon.count) : '—', s: r.align ? (r.align.valid ? 'aligned' : 'alignment not valid') : 'not aligned yet' },
    ];

  const obsItems: [keyof typeof r.observations, string, string][] = [
    ['occlusion', 'Occlusion', 'Surfaces hidden from the two LiDAR stations (e.g. under the seat) are missing in the LiDAR cloud.'],
    ['missing', 'Missing geometry', 'Regions with no reconstructed points (back/underside, textureless faces).'],
    ['texture', 'Texture differences', 'Colour comes from the photo for the reconstruction but from the material albedo in the LiDAR scan.'],
    ['geometry', 'Geometric inaccuracies', 'Wavy or offset surfaces in the error map, especially at grazing views or far from the cameras.'],
  ];

  const controls = (
    <>
      <Seg value={pane} onChange={setPane} options={[{ value: 'scene', label: '1 · Scene' }, { value: 'build', label: '2 · Build' }, { value: 'compare', label: '3 · Compare' }]} label="Step" />
      {pane === 'scene' && (<>
      <Callout kind="edu" title="From photos to 3D, checked against LiDAR">
        Photographs of a scene are turned into 3D, then compared with a LiDAR scan of the <b>same scene</b>. LiDAR measures distance directly, so it is the reference that shows where the image-based result is off. All of this is simulated in your browser.
      </Callout>
      <Section title="Choose a scene">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }} data-testid="scene-picker">
          {thumbs.map(({ id, photo }) => (
            <button key={id} onClick={() => pickScene(id)} aria-pressed={r.object === id} data-testid={`scene-${id}`}
              style={{ textAlign: 'left', padding: 5, borderRadius: 12, border: r.object === id ? '2px solid #0a84ff' : '2px solid transparent', background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,.1)', cursor: 'pointer' }}>
              <PhotoCanvas photo={photo} width="100%" />
              <div style={{ fontSize: 12.5, fontWeight: 600, padding: '4px 3px 0' }}>{RECON_SCENES[id].label}</div>
            </button>
          ))}
        </div>
        <p className="hint">{info.blurb}</p>
      </Section>
      <Section title="Photos or depth frames">
        <Select label="Image-based method" value={method} options={METHODS} onChange={(m) => { setMethod(m); setR({ align: null, cmp: null }); }} />
        {method === 'photogrammetry' && <p className="hint">Several photos → matching → depth fusion. Textureless faces fail, scale is unknown, poses carry small errors.</p>}
        {method === 'rgbd' && <p className="hint">Depth camera with known poses: metric scale and low noise, but limited to what the cameras saw.</p>}
        {method === 'monocular' && <p className="hint">One photo only: depth has unknown scale/shift and smooth distortion, and nothing behind the objects exists.</p>}
        {method === 'external' && <p className="hint">Upload a PLY/PCD you produced with NeRF, 3D Gaussian Splatting or an image-to-3D model (export the point cloud / mesh vertices).</p>}
        {(method === 'photogrammetry' || method === 'rgbd') && <Slider label="Number of views" value={r.views} min={2} max={16} step={1} onChange={(views) => setR({ views })} />}
        <input ref={fileRef} type="file" accept=".ply,.pcd,.las" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { const c = await loadFile(f); c.meta.kind = 'reconstructed'; setR({ ai: c, align: null, cmp: null }); } catch (err) { s.notify((err as Error).message, 'error'); } } e.target.value = ''; }} />
        <Btn variant="primary" icon={method === 'external' ? <Upload size={15} /> : <Play size={15} />} onClick={genRecon} busy={busy?.startsWith('Reconstructing') ?? false}>{method === 'external' ? 'Upload result' : 'Reconstruct in 3D'}</Btn>
      </Section>
      </>)}
      {pane === 'build' && (<>
      <Section title="Surface reconstruction (meshing)">
        <p className="hint">Turns the reconstructed points into a surface of triangles.</p>
        <Seg value={meshOpts.method} onChange={(m) => setMeshOpts({ ...meshOpts, method: m })} label="Meshing method" options={[{ value: 'voxel', label: 'Voxel surface' }, { value: 'smooth', label: 'Smoothed surface' }]} />
        <Slider label="Cell size" value={meshOpts.voxel * 100} min={1.5} max={8} step={0.5} unit=" cm" format={(v) => v.toFixed(1)} onChange={(v) => setMeshOpts({ ...meshOpts, voxel: v / 100 })} hint="Small cells keep detail but leave holes; large cells fill holes but blur detail." />
        <Btn variant="primary" onClick={buildMesh} disabled={!recon} busy={busy === 'Building the surface…'} testId="build-mesh">Build surface</Btn>
        {meshShown && <span className="caption">{fmtN(meshShown.indices.length / 3)} triangles</span>}
      </Section>
      </>)}
      {pane === 'compare' && (<>
      <Section title="Align & measure">
        {r.align && !r.align.valid && <Callout kind="bad" title="Alignment not valid">Fitness {(r.align.fitness * 100).toFixed(0)} %, RMSE {(r.align.rmse * 100).toFixed(1)} cm — no error statistics are reported. Try more views or another method.</Callout>}
        {aligned && hid && <Callout kind="good" title="Validation (simulation only)">Estimated scale correction {aligned.scale.toFixed(3)} vs true {(1 / hid.scale).toFixed(3)} — the hidden arbitrary scale of the reconstruction was recovered.</Callout>}
        {aligned && <Slider label="Error colour range" value={r.errMax} min={0.01} max={0.2} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(errMax) => setR({ errMax })} />}
      </Section>
      <Section title="View">
        <Seg value={r.layer} onChange={(layer) => setR({ layer })} options={[{ value: 'scene', label: 'Scene' }, { value: 'photo', label: 'Photo' }, { value: 'lidar', label: 'LiDAR' }, { value: 'recon', label: 'Recon' }]} />
        <Seg value={r.layer} onChange={(layer) => setR({ layer })} options={[{ value: 'mesh', label: 'Mesh' }, { value: 'overlay', label: 'Overlay' }, { value: 'error', label: 'Error map' }]} />
        <Seg value={r.layout} onChange={(layout) => setR({ layout })} options={[{ value: 'single', label: 'Single view' }, { value: 'split', label: 'Split · synced orbit' }]} />
        <Toggle label="Show the true model" checked={showGt} onChange={setShowGt} />
        <Toggle label="Real colours" checked={rgbColour} onChange={setRgbColour} />
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
      <Section title="Observations">
        {obsItems.map(([k, label, hint]) => <Toggle key={k} label={label} checked={r.observations[k]} onChange={(v) => setR({ observations: { ...r.observations, [k]: v } })} hint={hint} />)}
      </Section>
      </>)}
    </>
  );

  return (
    <TabFrame
      title="Image to 3D"
      tab={15}
      viewport={viewport}
      controls={controls}
      learn={null}
      noPanelTabs
      noEnv
      statsRow
      stats={stats}
      viewExtras={<>
        <Btn sm icon={<Play size={15} />} onClick={genLidar} busy={busy === 'Scanning the object with LiDAR…'} testId="lidar-scan">LiDAR</Btn>
        <Btn sm variant="primary" icon={method === 'external' ? <Upload size={15} /> : <Play size={15} />} onClick={genRecon} busy={busy?.startsWith('Reconstructing') ?? false} testId="reconstruct">{method === 'external' ? 'Upload result' : 'Reconstruct'}</Btn>
        <Btn sm onClick={buildMesh} disabled={!recon} busy={busy === 'Building the surface…'} testId="mesh-toolbar">Mesh</Btn>
        <Btn sm variant="primary" onClick={align} disabled={!r.lidar || !recon} busy={busy?.startsWith('Aligning') ?? false} testId="align-recon">Align</Btn>
      </>}
      overlays={
        <>
          {out && !photoLayer && <button className="overlay glass card" style={{ right: 12, bottom: 12, padding: 6, display: 'flex', gap: 6, border: 0, cursor: 'pointer' }} onClick={() => setR({ layer: 'photo', layout: 'single' })} title="Open all the images" data-testid="photo-strip">{out.photos.slice(0, 3).map((ph, i) => <PhotoCanvas key={i} photo={ph} width={96} />)}</button>}
          {r.layer === 'error' && aligned && <div className="overlay glass card" style={{ right: 12, top: 70, width: 200 }}><div className="caption">distance to LiDAR</div><div style={{ height: 10, borderRadius: 6, background: `linear-gradient(90deg,${Array.from({ length: 10 }, (_, i) => { const c = turbo(i / 9); return `rgb(${c[0]},${c[1]},${c[2]})`; }).join(',')})` }} /><div style={{ display: 'flex', justifyContent: 'space-between' }} className="mono caption"><span>0</span><span>{(r.errMax * 1000).toFixed(0)} mm</span></div></div>}
        </>
      }
    />
  );
}
