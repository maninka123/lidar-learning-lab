import { useState } from 'react';
import { Seg } from '../ui/controls';
import Tab3 from './Tab3TlsMls';
import Tab4 from './Tab4Slam';

/** One tab for everything about getting scans into a common frame: scanning stations (TLS / MLS), SLAM drift and ICP registration. */
export default function TabMapping() {
  const [lab, setLab] = useState<'scan' | 'slam' | 'reg'>('scan');
  const sw = <Seg block={false} value={lab} onChange={setLab} label="Lab" options={[{ value: 'scan', label: 'Scanning' }, { value: 'slam', label: 'SLAM' }, { value: 'reg', label: 'Registration' }]} />;
  return lab === 'scan' ? <Tab3 labSwitch={sw} /> : <Tab4 lab={lab} labSwitch={sw} />;
}
