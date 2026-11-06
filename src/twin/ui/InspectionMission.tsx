import { Btn } from '../../ui/controls';
import { cameraItem, INSPECTION_CAMERA_ID, type CameraUnit, type LidarUnit } from '../catalogue';
import type { InspectionCoverage } from '../inspection';

export function InspectionMission({ camera, lidar, lidarNumber, preview, busy, onPlace, onCalibrate }: { camera?: CameraUnit; lidar?: LidarUnit; lidarNumber?: number; preview: InspectionCoverage; busy: boolean; onPlace: () => void; onCalibrate: () => void }) {
  const row = preview.cameras.find((c) => c.id === camera?.id);
  return <section className="inspection-mission" aria-label="Critical camera area" data-testid="inspection-mission">
    <div className="mission-eyebrow">Camera required</div>
    <h3>Critical visual inspection bay</h3>
    <p>The outlined bay contains six colour-label stations. One camera and its paired LiDAR must cover at least five of them.</p>
    <div className="inspection-assigned"><b>{camera ? cameraItem(camera.item).name : '720p inspection camera'}</b><span>{!camera ? 'Free up budget to add the specified camera.' : camera.id === INSPECTION_CAMERA_ID ? 'Already in your equipment · placement and calibration required' : 'Existing camera selected for this task'}</span></div>
    <dl>
      <div><dt>Camera sees <small>geometric preview</small></dt><dd>{row?.visible ?? 0} / {preview.total} stations</dd></div>
      <div><dt>Shared with paired LiDAR</dt><dd>{row?.shared ?? 0} / {preview.total}</dd></div>
      <div><dt>Connection</dt><dd>{camera?.pairedLidarId && lidar ? `LiDAR ${lidarNumber} connected` : 'Choose a LiDAR'}</dd></div>
      <div><dt>Calibration</dt><dd>{camera?.cal.done ? 'Saved · verify ≤4 px' : 'Required · ≤4 px'}</dd></div>
    </dl>
    <div className="btn-row"><Btn sm onClick={onPlace} disabled={busy || !camera} testId="inspection-place">1 · Place and aim</Btn><Btn sm onClick={onCalibrate} disabled={busy || !camera} testId="inspection-calibrate">2 · Pair and calibrate</Btn></div>
    <p className="hint">Place both devices where they see the label fronts. The mission test checks actual LiDAR returns and calibration, as well as this preview.</p>
  </section>;
}
