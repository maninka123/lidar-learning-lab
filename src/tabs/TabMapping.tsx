import { useEffect, useState } from 'react';
import { useLab } from '../state/store';
import { Seg } from '../ui/controls';
import Tab3 from './Tab3TlsMls';
import Tab4 from './Tab4Slam';

/** One tab for everything about getting scans into a common frame: scanning stations (TLS / MLS), SLAM drift and loop closure. */
export default function TabMapping() {
  const [lab, setLab] = useState<'scan' | 'slam'>('scan');
  // the city district is the environment for this tab: switch on entry, restore the previous environment on exit
  useEffect(() => {
    const st = useLab.getState();
    const prev = st.sceneId;
    const prevOpacity = st.view.sceneOpacity;
    if (prev !== 'D') { st.setScene('D'); st.setView({ sceneOpacity: 0.6 }); }
    return () => { useLab.getState().setView({ sceneOpacity: prevOpacity }); if (useLab.getState().sceneId === 'D') useLab.getState().setScene(prev === 'D' ? 'C' : prev); };
  }, []);
  const sw = <Seg block={false} value={lab} onChange={setLab} label="Lab" options={[{ value: 'scan', label: 'Mobile scanning' }, { value: 'slam', label: 'SLAM' }]} />;
  return lab === 'scan' ? <Tab3 labSwitch={sw} /> : <Tab4 lab={lab} labSwitch={sw} />;
}
