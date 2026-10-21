import { useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { TabFrame } from '../ui/TabFrame';
import { Btn, MiniSlider, Section } from '../ui/controls';
import { Plus } from '../ui/icons';
import { CompareSensors, CmpPanel } from './CompareSensors';
import { D2R } from '../core/math';

export default function TabCompareSensors() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const b = scene.bounds;
  const [panels, setPanels] = useState<CmpPanel[]>([{ key: 1, preset: 'rot16' }, { key: 2, preset: 'rot128' }]);
  const controls = (
    <>
      <Section title="Environment & views">
        <p className="hint">Pick the environment from the menu at the top. Each view scans it with the sensor you choose; the cameras move together.</p>
        <Btn icon={<Plus size={16} />} onClick={() => setPanels([...panels, { key: Math.max(...panels.map((p) => p.key)) + 1, preset: 'rot32' }])} disabled={panels.length >= 4} testId="add-view" block>Add another view ({panels.length} of 4)</Btn>
      </Section>
      <Section title="Scanner position (same for every view)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
          <MiniSlider label="X" value={s.pose.x} min={b.min[0] + 0.3} max={b.max[0] - 0.3} step={0.05} unit=" m" format={(v) => v.toFixed(1)} onChange={(x) => s.setPose({ x })} />
          <MiniSlider label="Y" value={s.pose.y} min={b.min[1] + 0.3} max={b.max[1] - 0.3} step={0.05} unit=" m" format={(v) => v.toFixed(1)} onChange={(y) => s.setPose({ y })} />
          <MiniSlider label="Height" value={s.pose.z} min={0.1} max={Math.max(2.8, b.max[2] - 0.2)} step={0.05} unit=" m" format={(v) => v.toFixed(1)} onChange={(z) => s.setPose({ z })} />
          <MiniSlider label="Heading" value={Math.round(s.pose.yaw / D2R)} min={-180} max={180} step={1} unit="°" onChange={(d) => s.setPose({ yaw: d * D2R })} />
          <MiniSlider label="Pitch (+ = up)" value={Math.round(s.pose.pitch / D2R)} min={-60} max={60} step={1} unit="°" onChange={(d) => s.setPose({ pitch: d * D2R })} />
        </div>
      </Section>
    </>
  );
  return <TabFrame title="Compare Sensors" tab={2} viewport={<CompareSensors panels={panels} onChange={setPanels} />} controls={controls} learn={null} noPanelTabs hideViewControls />;
}
