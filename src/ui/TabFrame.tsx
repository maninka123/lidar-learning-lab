import { ReactNode, useState } from 'react';
import { useLab } from '../state/store';
import { Seg } from './controls';
import type { SceneId } from '../scenes';
import { StatsCard, TopBar, ViewControls } from './shared';

export interface TabFrameProps {
  title: string;
  tab: number;
  viewport: ReactNode;
  controls: ReactNode;
  learn: ReactNode;
  stats?: { k: string; v: ReactNode; s?: string }[];
  overlays?: ReactNode;
  hideViewControls?: boolean;
  viewExtras?: ReactNode;
  statsRow?: boolean;
  hideExercise?: boolean;
  noPanelTabs?: boolean;
  topExtras?: ReactNode;
  envIds?: SceneId[]; // environments offered in the Environment menu (default: the three standard scenes)
  noEnv?: boolean; // hide the Environment menu (tabs that do not use a scene)
  simple?: boolean; // controls only: no Exercise / Learn panes, minimal top bar
}

export function TabFrame({ title, tab, viewport, controls, learn, stats, overlays, hideViewControls, simple, viewExtras, statsRow, hideExercise, noPanelTabs, topExtras, noEnv, envIds }: TabFrameProps) {
  const open = useLab((s) => s.rightOpen);
  const [pane, setPane] = useState<'controls' | 'learn'>('controls');
  return (
    <>
      <TopBar title={title} minimal={simple} extra={topExtras} noEnv={noEnv} envIds={envIds} />
      <div className="tab-body">
        <div className="stage" data-testid="stage">
          {viewport}
          {!hideViewControls && <ViewControls simple={simple} extra={viewExtras} />}
          {stats && <StatsCard items={stats} row={statsRow} />}
          {overlays}
        </div>
        <aside className={`right glass ${open ? '' : 'closed'}`} aria-label="Experiment controls" data-testid="right-panel">
          {!simple && !noPanelTabs && <div style={{ padding: '0.8rem 1rem 0.4rem' }}>
            <Seg value={pane} onChange={setPane} label="Panel" options={[{ value: 'controls', label: 'Controls' }, { value: 'learn', label: 'Learn' }]} />
          </div>}
          <div className="right-body" key={pane}>
            <div className="fade-in" style={{ display: 'grid', gap: 0 }}>
              {pane === 'controls' && controls}
              {pane === 'learn' && <div style={{ display: 'grid', gap: 12, paddingTop: 12 }}>{learn}</div>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
