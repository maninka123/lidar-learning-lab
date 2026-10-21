import { useMemo } from 'react';
import { Btn } from './controls';
import { X } from './icons';
import { downloadBlob } from '../io/load';

/** Shows a point-cloud file as text: header lines in blue, then one row per point. */
export function RawViewer({ text, filename, onClose, maxRows = 400 }: { text: string; filename: string; onClose: () => void; maxRows?: number }) {
  const lines = useMemo(() => text.split('\n').filter((l) => l.length), [text]);
  const headerEnd = Math.max(0, lines.findIndex((l) => l.startsWith('DATA')) + 1);
  return (
    <div className="overlay glass-strong card" style={{ left: 12, top: 168, bottom: 12, width: 'min(560px, calc(100% - 24px))', display: 'flex', flexDirection: 'column', gap: 8, padding: '0.7rem 0.8rem', zIndex: 5 }} data-testid="raw-view">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ flex: 1 }}>{filename} <span className="caption">· the file a LiDAR scan is stored in</span></b>
        <Btn sm onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), filename)}>Download</Btn>
        <button className="btn sm icon" onClick={onClose} aria-label="Close raw view" style={{ width: 32 }}><X size={15} /></button>
      </div>
      <div className="mono" style={{ flex: 1, overflow: 'auto', fontSize: '0.8125rem', lineHeight: 1.55, background: 'var(--fill)', borderRadius: 12, padding: '0.6rem 0.8rem', whiteSpace: 'pre' }}>
        {lines.slice(0, headerEnd + maxRows).map((l, i) => <div key={i} style={{ color: i < headerEnd ? '#0a60c9' : 'var(--text)' }}>{l}</div>)}
        {lines.length > headerEnd + maxRows && <div className="caption">… {lines.length - headerEnd - maxRows} more points not shown (Download has them all)</div>}
      </div>
      <span className="caption">Blue = header (describes the data). Each row below it is one point; the columns are listed in FIELDS.</span>
    </div>
  );
}
