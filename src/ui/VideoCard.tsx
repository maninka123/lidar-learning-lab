import { useEffect, useRef, useState } from 'react';
import { X, Play } from './icons';

export interface VideoInfo { id: string; title: string; by: string; channel: string; about?: string; tab?: number; tabName?: string }
const FP = { by: 'Dr. Florent Poux', channel: 'https://www.youtube.com/@FlorentPoux' };
export const VIDEOS: Record<string, VideoInfo> = {
  library: { id: 'X57nSQZePyE', title: 'The library point cloud', ...FP, about: 'A coloured point cloud of a library: SLAM reconstruction, colour from the camera, surface finish.', tab: 9, tabName: 'Meshing & Surfaces' },
  university: { id: '8nzo4YobRyc', title: '[Point Cloud] University', ...FP, about: 'A larger coloured campus point cloud.', tab: 9, tabName: 'Meshing & Surfaces' },
  implant: { id: 'Hy4hnWMw5ms', title: '[3D STUDENTS] Implantation Point Cloud', ...FP, about: 'A point cloud shown without colour: just the points.', tab: 9, tabName: 'Meshing & Surfaces' },
  factory: { id: 'Kq8FKKODkog', title: 'Abandonned Point Cloud Series : Old whool factory', ...FP, about: 'An abandoned factory captured as a coloured point cloud.', tab: 9, tabName: 'Meshing & Surfaces' },
  cad: { id: 'Z8uAzTqdSts', title: 'How to Turn 3D Scan to CAD (.dxf, .dwg) for AEC', ...FP, about: 'Slice a scan, find the walls, export a floor plan for CAD.', tab: 12, tabName: 'Scan to CAD' },
  ransac: { id: 'MJJNIvvAQzc', title: '3D Plane Detection with Adaptive RANSAC (100% Workflow Automation)', ...FP, about: 'Find floors, ceilings and walls automatically, with settings measured from the data.', tab: 10, tabName: 'Clustering & Segmentation' },
  change: { id: '38Fu-pDwUoA', title: 'Smart 3D Change Detection: Complete Python Tutorial (point clouds)', ...FP, about: 'Compare two scans of the same place and find what changed.', tab: 13, tabName: 'Change Detection' },
};

/** A video thumbnail with credit. Clicking opens a pop-up player that starts playing. */
export function VideoCard({ video }: { video: VideoInfo }) {
  const [open, setOpen] = useState(false);
  const player = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid={`video-${video.id}`} aria-label={`Play video: ${video.title}`} style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 10, alignItems: 'center', textAlign: 'left', border: '1px solid var(--line, #d2d2d7)', borderRadius: 12, padding: 8, background: '#fff', cursor: 'pointer', width: '100%' }}>
        <span style={{ position: 'relative', display: 'block', aspectRatio: '16 / 9', borderRadius: 8, overflow: 'hidden', background: '#1d1d1f' }}>
          <img src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><span style={{ width: 30, height: 30, borderRadius: 15, background: 'rgba(0,0,0,.6)', color: '#fff', display: 'grid', placeItems: 'center' }}><Play size={14} /></span></span>
        </span>
        <span style={{ display: 'grid', gap: 2 }}>
          <b style={{ fontSize: '0.9375rem', lineHeight: 1.25 }}>{video.title}</b>
          <span className="caption">Video by {video.by}</span>
        </span>
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={video.title} onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1100px, 100%)', background: '#fff', borderRadius: 16, padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}><b>{video.title}</b><div className="caption">Video by <a href={video.channel} target="_blank" rel="noreferrer">{video.by}</a> · <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">Open on YouTube</a></div></div>
              <button className="btn sm" onClick={() => { const el = player.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); }} aria-label="Full screen" data-testid="video-fullscreen">Full screen</button>
              <button className="btn sm icon" onClick={() => setOpen(false)} aria-label="Close the video" data-testid="video-close"><X size={16} /></button>
            </div>
            <div ref={player} style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
              <iframe src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`} title={video.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Credit({ keys, title = 'Watch and learn' }: { keys: string[]; title?: string }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {title && <b style={{ fontSize: '0.9375rem' }}>{title}</b>}
      {keys.map((k) => <VideoCard key={k} video={VIDEOS[k]} />)}
    </div>
  );
}
