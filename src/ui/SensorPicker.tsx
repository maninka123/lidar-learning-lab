import { Select } from './controls';
import { FAMILIES, FAMILY_GROUPS, familyLabel, familyOf, getPreset } from '../sensor/presets';

/** Generic scanner type first; then the commercial models of that type. `only` limits the allowed family ids. */
export function SensorPicker({ value, onPick, only }: { value: string; onPick: (id: string) => void; only?: string[] }) {
  const fam = familyOf(value);
  const groups = FAMILY_GROUPS.map((g) => ({ label: g.label, ids: g.ids.filter((id) => !only || only.includes(id)) })).filter((g) => g.ids.length);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="sensor-picker">
      <Select label="Scanner type" value={fam.id} options={FAMILIES.map((f) => ({ value: f.id, label: f.label }))} groups={groups.map((g) => ({ label: g.label, options: g.ids.map((id) => ({ value: id, label: familyLabel(id) })) }))} onChange={(id) => onPick(FAMILIES.find((f) => f.id === id)!.models[0])} />
      <div className="field">
        <label>Sensor presets</label>
        <div className="chip-row">{fam.models.map((m) => <button key={m} className="chip" aria-pressed={m === value} onClick={() => onPick(m)} data-testid={`sensor-${m}`}>{getPreset(m).name}</button>)}</div>
      </div>
    </div>
  );
}
