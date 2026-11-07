import type { ReactNode } from 'react';
import { Btn } from '../../ui/controls';
import { cameraItem, INSPECTION_CAMERA_ID, type CameraUnit } from '../catalogue';
import type { InspectionCoverage } from '../inspection';

interface Props {
  camera?: CameraUnit; preview: InspectionCoverage; busy: boolean;
  /** the tool that is open: 2 place, 3 calibrate, 5 colours, 7 results, 1 equipment and extras */
  stage: number;
  /** what the open tool shows: it appears under its own step */
  panel: ReactNode;
  hasColour: boolean; resultLevel?: 'needs-improvement' | 'passed' | 'excellent'; stale?: boolean; canEvaluate: boolean;
  onOpen: (stage: number) => void; onPlace: () => void; onColours: () => void; onEvaluate: () => void;
}

/** Task 5 as four steps in order. The tool for the open step opens right under it. The LiDARs stay where task 1 put them: only the camera is placed here. */
export function InspectionMission({ camera, preview, busy, stage, panel, hasColour, resultLevel, stale, canEvaluate, onOpen, onPlace, onColours, onEvaluate }: Props) {
  const row = preview.cameras.find((c) => c.id === camera?.id);
  const seen = row?.visible ?? 0, shared = row?.shared ?? 0, need = Math.ceil(preview.total * 0.8);
  const placed = seen >= need, calibrated = !!camera?.cal.done;
  const passed = !!resultLevel && !stale && resultLevel !== 'needs-improvement';
  const steps = [
    { n: 1, stage: 2, done: placed, title: 'Place the camera', status: !camera ? 'No inspection camera yet.' : `The camera sees ${seen} of ${preview.total} label stations (needs ${need}).`, action: 'Place and aim', testId: 'inspection-place', onClick: onPlace, disabled: busy || !camera },
    { n: 2, stage: 3, done: calibrated, title: 'Register the camera with the point cloud', status: !camera ? '' : calibrated ? `Calibrated. The camera and the LiDARs both reach ${shared} of ${preview.total} stations.` : 'Match the red markers to the green ones (error below 3 px).', action: 'Calibrate', testId: 'inspection-calibrate', onClick: () => onOpen(3), disabled: busy || !camera },
    { n: 3, stage: 5, done: hasColour, title: 'Read the colour labels', status: hasColour ? 'The colour block is in your pipeline.' : 'Add the colour block: it reads each label from the camera colours.', action: hasColour ? 'Open the pipeline' : 'Add the colour block', testId: 'inspection-colours', onClick: onColours, disabled: busy },
    { n: 4, stage: 7, done: passed, title: 'Check the result', status: !resultLevel ? (placed && calibrated && hasColour ? 'All set: evaluate to check the result.' : 'Finish steps 1 to 3, then evaluate.') : stale ? 'Changed since the last check: evaluate again.' : resultLevel === 'needs-improvement' ? 'Not there yet: see what to fix in the check below.' : 'Passed.', action: 'Evaluate', testId: 'inspection-evaluate', onClick: onEvaluate, disabled: busy || !canEvaluate },
  ];
  const next = steps.find((s) => !s.done)?.n;
  return <section className="inspection-mission task-steps" aria-label="Task steps" data-testid="inspection-mission">
    <div className="mission-eyebrow">Camera required</div>
    <p className="task-steps-intro">Aim <b>{camera ? cameraItem(camera.item).name : 'the 720p inspection camera'}</b>{camera?.id === INSPECTION_CAMERA_ID ? ' (already yours)' : ''} at the outlined bay, calibrate it against the LiDAR cloud, then read the labels. The LiDARs stay where task 1 put them.</p>
    <ol>
      {steps.map((s) => <li key={s.n} className={`${s.done ? 'done' : ''} ${stage === s.stage ? 'open' : ''} ${next === s.n ? 'next' : ''}`}>
        <button type="button" className="task-step-head" onClick={() => onOpen(s.stage)} aria-expanded={stage === s.stage} data-testid={`inspection-step-${s.n}`}>
          <i className="task-step-badge" aria-hidden="true">{s.done ? '✓' : s.n}</i>
          <span className="task-step-body"><b>{s.title}</b>{s.status && <small>{s.status}</small>}</span>
        </button>
        {stage === s.stage ? <div className="task-step-panel" key={stage}>{panel}</div> : <Btn sm variant={next === s.n ? 'primary' : ''} onClick={s.onClick} disabled={s.disabled} testId={s.testId}>{s.action}</Btn>}
      </li>)}
    </ol>
    <div className="task-steps-more"><button type="button" className="linkish" onClick={() => onOpen(stage === 1 ? 2 : 1)} data-testid="inspection-extras">{stage === 1 ? 'Close the extras' : 'Optional: more cameras, lamps'}</button></div>
    {stage === 1 && <div className="task-step-panel" key="extras">{panel}</div>}
  </section>;
}
