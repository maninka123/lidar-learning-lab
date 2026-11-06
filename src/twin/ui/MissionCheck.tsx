import { Btn } from '../../ui/controls';
import { Play } from '../../ui/icons';

interface MissionCheckProps {
  target: string;
  coverage?: { value: 'all' | 'critical'; onChange: (value: 'all' | 'critical') => void };
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
  onEvaluate: () => void;
}

export function MissionCheck({ target, coverage, busy, disabled, disabledReason, onEvaluate }: MissionCheckProps) {
  return (
    <section className="mission-check" aria-label={coverage ? 'Coverage check' : 'Mission check'}>
      <div className="mission-check-heading">
        <h3>{coverage ? 'Coverage check' : 'Mission check'}</h3>
        {coverage && <label className="mission-preview-select">
          <span>Preview</span>
          <select aria-label="Coverage preview" value={coverage.value} onChange={(e) => coverage.onChange(e.target.value as 'all' | 'critical')}>
            <option value="critical">Critical areas</option>
            <option value="all">Whole factory</option>
          </select>
        </label>}
      </div>
      <p className="mission-check-target" data-testid="mission-targets">{target.replace(/^Pass:\s*/, '')}</p>
      <Btn variant="primary" icon={<Play size={14} />} onClick={onEvaluate} busy={busy} disabled={disabled} testId="mission-evaluate">
        {coverage ? 'Test coverage' : 'Evaluate mission'}
      </Btn>
      {disabled && !busy && disabledReason && <p className="mission-check-help">{disabledReason}</p>}
    </section>
  );
}
