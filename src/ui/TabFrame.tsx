import { ReactNode, useState } from 'react';
import { useLab } from '../state/store';
import { Seg } from './controls';
import { ExercisePanel, StatsCard, TopBar, ViewControls } from './shared';

export interface TabFrameProps {
  title: string;
  tab: number;
  viewport: ReactNode;
  controls: ReactNode;
  learn: ReactNode;
  stats?: { k: string; v: ReactNode; s?: string }[];
  overlays?: ReactNode;
  hideViewControls?: boolean;
}

export function TabFrame({ title, tab, viewport, controls, learn, stats, overlays, hideViewControls }: TabFrameProps) {
  const open = useLab((s) => s.rightOpen);
  const [pane, setPane] = useState<'controls' | 'exercise' | 'learn'>('controls');
  return (
    <>
      <TopBar title={title} />
      <div className="tab-body">
        <div className="stage" data-testid="stage">
          {viewport}
          {!hideViewControls && <ViewControls />}
          {stats && <StatsCard items={stats} />}
          {overlays}
        </div>
        <aside className={`right glass ${open ? '' : 'closed'}`} aria-label="Experiment controls" data-testid="right-panel">
          <div style={{ padding: '0.8rem 1rem 0.4rem' }}>
            <Seg value={pane} onChange={setPane} label="Panel" options={[{ value: 'controls', label: 'Controls' }, { value: 'exercise', label: 'Exercise' }, { value: 'learn', label: 'Learn' }]} />
          </div>
          <div className="right-body" key={pane}>
            <div className="fade-in" style={{ display: 'grid', gap: 0 }}>
              {pane === 'controls' && controls}
              {pane === 'exercise' && <ExercisePanel tab={tab} />}
              {pane === 'learn' && <div style={{ display: 'grid', gap: 12, paddingTop: 12 }}>{learn}</div>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
