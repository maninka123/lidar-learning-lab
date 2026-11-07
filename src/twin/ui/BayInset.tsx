import { useEffect, useRef } from 'react';
import type { CamImage } from '../camera';
import type { LabelColour } from '../factory';

export interface LabelEvent { id: string; name: string; from: LabelColour; to: LabelColour }
export interface BayView { a: CamImage; b: CamImage; crop: { sx: number; sy: number; sw: number; sh: number }; marks: { id: string; u: number; v: number; n: number }[] }
const CSS: Record<string, string> = { red: '#ff453a', green: '#30d158', yellow: '#ffd60a', none: '#8e8e93' };
const toCanvas = (img: CamImage) => { const c = document.createElement('canvas'); c.width = img.w; c.height = img.h; c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgb), img.w, img.h), 0, 0); return c; };

/** A zoomed look at the inspection bay's colour labels, inside the 3D view. It follows the time: Time A, then the objects have moved (Time B's picture), then the labels change colour. */
export function BayInset({ view, events, tick }: { view: BayView; events: LabelEvent[]; tick: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const A = toCanvas(view.a), B = toCanvas(view.b), { sx, sy, sw, sh } = view.crop, W = 560, H = Math.round(W * sh / sw), z = W / sw, changed = new Set(events.map((e) => e.id));
    c.width = W; c.height = H; const g = c.getContext('2d')!; g.imageSmoothingEnabled = true;
    g.drawImage(tick >= 2 ? B : A, sx, sy, sw, sh, 0, 0, W, H); // the moved objects are in place from the second step on
    for (const m of view.marks) {
      const x = (m.u - sx) * z, y = (m.v - sy) * z, on = changed.has(m.id) && tick >= 3;
      if (changed.has(m.id) && tick === 2) { g.save(); g.beginPath(); g.arc(x, y, 30, 0, Math.PI * 2); g.clip(); g.drawImage(A, sx, sy, sw, sh, 0, 0, W, H); g.restore(); } // its label still has the old colour
      g.lineWidth = on ? 4 : 1.5; g.strokeStyle = on ? '#0a84ff' : 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(x, y, on ? 26 : 16, 0, Math.PI * 2); g.stroke();
      g.fillStyle = on ? '#0a84ff' : 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(x, y - (on ? 40 : 30), 11, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = '700 13px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(m.n), x, y - (on ? 40 : 30));
    }
  }, [view, events, tick]);
  const shown = tick >= 3 ? events : [];
  return <div className="overlay glass card bay-inset" data-testid="bay-inset">
    <div className="bay-inset-head"><b>Colour labels, inspection bay</b><span>{tick >= 3 ? 'Time B' : tick >= 2 ? 'Objects moved' : 'Time A'}</span></div>
    <canvas ref={cv} aria-label="Zoomed colour labels of the inspection bay" />
    <ul className="bay-events" aria-live="polite">{shown.length ? shown.map((e) => <li key={e.id}><b>{e.name}</b><i style={{ background: CSS[e.from] }} />{e.from}<em>→</em><i style={{ background: CSS[e.to] }} />{e.to}</li>) : <li className="quiet">No label has changed yet</li>}</ul>
  </div>;
}
