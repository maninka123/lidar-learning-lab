import { useState } from 'react';
import { Camera, Check, Crosshair, Dots, Eye, Plus, Radar } from '../../ui/icons';
import { LIDARS, SHOP_LIDARS, CAMERAS, sensorFor } from '../catalogue';
import { PRICING, usd } from '../pricing';
import { LidarPreview } from './LidarPreview';

const KIND_LABEL: Record<string, string> = { low: 'Rotating', medium: 'Rotating', high: 'Rotating', multi: 'Rotating', solid: 'Solid-state', tls: 'Terrestrial', mobile: 'Mobile' };
const SPEC_ROWS = [['range', 'Range'], ['fov', 'Field of view'], ['resolution', 'Resolution'], ['density', 'Density'], ['accuracy', 'Accuracy'], ['use', 'Best for']] as const;

export function EquipmentCatalogue({ cameras, scale, canBuy, buy, owned, removeOne }: { cameras: boolean; scale: number; canBuy: (id: string) => boolean; buy: (id: string) => void; /** how many of this model are already in the project (the same model can be bought as often as the budget and limits allow) */ owned?: (id: string) => number; removeOne?: (id: string) => void }) {
  const [compare, setCompare] = useState<string[]>([]), [preview, setPreview] = useState<string | null>(null); // a LiDAR whose picture is open
  const items = cameras ? CAMERAS : SHOP_LIDARS;
  const specs = (id: string) => {
    const c = CAMERAS.find((x) => x.id === id); if (c) return { range: 'Light and geometry limited', fov: `${c.fov}°`, resolution: `${c.w} × ${c.h} px`, accuracy: 'Depends on calibration', density: `${(c.w * c.h / 1e6).toFixed(2)} MP`, use: c.id === 'cam-lowlight' ? 'Dark areas, low noise' : c.id === 'cam-wide' ? 'Broad view, fewer pixels per label' : 'Reading labels, needs light' };
    const it = LIDARS.find((x) => x.id === id)!;
    const s = sensorFor({ id: 'preview', item: id, res: 'standard', x: 0, y: 0, z: 1.8, yaw: 0, pitch: 0 });
    return { range: `${s.maxRange} m`, fov: `${s.hFov}° × ${(s.vMax - s.vMin).toFixed(0)}°`, resolution: `${s.channels} ch · ${s.hRes}° step`, accuracy: `${(it.noise * 100).toFixed(1)} cm noise (1σ)`, density: `≤ ${(it.maxRays / 1000).toFixed(0)}k rays / scan`, use: it.blurb };
  };
  const name = (id: string) => [...LIDARS, ...CAMERAS].find((i) => i.id === id)?.name ?? id;
  return <div className="equipment">
    {items.map((it) => {
      const s = specs(it.id), price = PRICING[it.id], ok = canBuy(it.id), picked = compare.includes(it.id), n = owned?.(it.id) ?? 0;
      const Icon = cameras ? Camera : Radar;
      return <article key={it.id} className={`equipment-card${picked ? ' picked' : ''}${ok ? '' : ' off'}`}>
        <div className="equipment-row">
          {cameras
            ? <span className="equipment-icon"><Icon size={18} /></span>
            : <button type="button" className="equipment-icon equipment-look" onClick={() => setPreview(it.id)} aria-label={`See how ${it.name} looks`} title="See how it looks" data-testid={`twin-look-${it.id}`}><Eye size={18} /></button>}
          <h4>{it.name}</h4>
          {n > 0 && <span className="equipment-owned" data-testid={`twin-count-${it.id}`} title={`${n} in your project`}>×{n}</span>}
          <span className="equipment-cost">{usd(it.cost * scale)}</span>
        </div>
        <div className="equipment-chips">
          <span title="Range"><Crosshair size={12} />{s.range}</span>
          <span title="Field of view"><Eye size={12} />{s.fov}</span>
          <span title="Resolution"><Dots size={12} />{s.resolution}</span>
        </div>
        <div className="equipment-actions">
          <button className="btn sm primary" onClick={() => buy(it.id)} disabled={!ok} data-testid={`twin-buy-${it.id}`} title={ok ? undefined : 'Over budget or at the equipment limit'}><Plus size={14} /> {ok ? (n > 0 ? 'Add another' : 'Add') : 'Unavailable'}</button>
          {n > 0 && removeOne && <button className="chip" onClick={() => removeOne(it.id)} aria-label={`Remove one ${it.name}`} data-testid={`twin-less-${it.id}`} title="Remove the last one you added">− One</button>}
          <button className="chip" aria-pressed={picked} onClick={() => setCompare((c) => picked ? c.filter((x) => x !== it.id) : [...c, it.id].slice(-3))} aria-label={`Compare ${it.name}`}>{picked ? <Check size={13} /> : null} Compare</button>
          <details className="equipment-more"><summary>Details</summary>
            <dl><div><dt>Best for</dt><dd>{s.use.replace(/\.$/, '')}</dd></div><div><dt>Accuracy</dt><dd>{s.accuracy}</dd></div><div><dt>Scan size</dt><dd>{s.density}</dd></div></dl>
            {price.source && <a href={price.source} target="_blank" rel="noreferrer">Price source ↗</a>}</details>
        </div>
      </article>;
    })}
    {compare.length > 1 && <div className="equipment-compare" data-testid="equipment-compare"><table className="table"><thead><tr><th /> {compare.map((id) => <th key={id}>{name(id)}</th>)}</tr></thead><tbody>{SPEC_ROWS.map(([k, l]) => <tr key={k}><th>{l}</th>{compare.map((id) => <td key={id}>{specs(id)[k]}</td>)}</tr>)}</tbody></table></div>}
    {preview && <LidarPreview id={preview} onClose={() => setPreview(null)} />}
  </div>;
}
