import type { CostReport } from '../catalogue';
import { usd } from '../pricing';

export function BudgetSummary({ cost, budget, hasLidar, mandatory }: { cost: CostReport; budget: number; hasLidar: boolean; /** what the required equipment already takes from the budget (the inspection camera and its installation) */ mandatory?: { label: string; amount: number } }) {
  const over = cost.total > budget;
  const errors = cost.errors.filter((error) => hasLidar || !error.includes('at least one LiDAR'));
  return (
    <section className={`mission-budget${over ? ' over' : ''}`} data-testid="twin-budget" aria-label="Project budget">
      <div className="mission-budget-heading"><span>Project budget</span><span className="mission-budget-currency">USD</span></div>
      <div className="mission-budget-balance" data-testid="twin-remaining"><strong>{usd(over ? -cost.remaining : cost.remaining)}</strong><span>{over ? 'over budget' : 'available'}</span></div>
      <div className="mission-budget-track" role="progressbar" aria-label="Equipment spending" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(budget, cost.total)} aria-valuetext={`${usd(cost.total)} spent of ${usd(budget)}`}>
        <span style={{ width: `${budget > 0 ? Math.min(100, cost.total / budget * 100) : 0}%` }} />
      </div>
      <div className="mission-budget-totals"><span>Spent <b>{usd(cost.total)}</b></span><span>Total <b>{usd(budget)}</b></span></div>
      {mandatory && <p className="mission-budget-note" data-testid="twin-mandatory-note">🔒 Includes {usd(mandatory.amount)} for the mandatory {mandatory.label} (cannot be removed).</p>}
      {errors.map((error) => <p className="mission-budget-error" key={error}>{error}</p>)}
      {cost.warnings.map((warning) => <p className="mission-budget-warning" key={warning}>{warning}</p>)}
    </section>
  );
}
