import { useEffect } from 'react';
import { useLab } from '../state/store';
import Tab4 from './Tab4Slam';

/** SLAM & Mobile Scanning: draw a route, run SLAM, and learn it in the side panel. */
export default function TabMapping() {
  // the city district is the environment for this tab: switch on entry, restore the previous environment on exit
  useEffect(() => {
    const st = useLab.getState();
    const prev = st.sceneId;
    const prevOpacity = st.view.sceneOpacity;
    if (prev !== 'D') { st.setScene('D'); st.setView({ sceneOpacity: 0.6 }); }
    return () => { useLab.getState().setView({ sceneOpacity: prevOpacity }); if (useLab.getState().sceneId === 'D') useLab.getState().setScene(prev === 'D' ? 'C' : prev); };
  }, []);
  return <Tab4 />;
}
