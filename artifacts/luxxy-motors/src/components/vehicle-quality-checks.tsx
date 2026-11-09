import type { MotHistory } from '@workspace/vehicle-meta';
import { CheckCircle2, CircleHelp, Clock3, Info } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import { vehicleQualityChecks } from '@/lib/vehicle-quality-checks';
import './vehicle-quality-checks.css';

export function VehicleQualityChecks({ car, motHistory, onAskTeam, dealerConfirmed = false }: {
  car: Car;
  motHistory?: MotHistory | null;
  onAskTeam?: (message: string) => void;
  dealerConfirmed?: boolean;
}) {
  const checks = vehicleQualityChecks(car, motHistory, new Date(), dealerConfirmed);
  const labels = { passed: 'Passed', unknown: 'Ask us', attention: 'See history', not_due: 'Not due yet' };
  return <section id="vehicle-quality-checks" className="vehicle-quality" aria-labelledby="vehicle-quality-heading">
    <header className="vehicle-quality__heading">
      <h2 id="vehicle-quality-heading">Quality is assured</h2>
      <p>{dealerConfirmed ? 'Carefully checked, inside and out, so you can choose with confidence.' : 'View the checks and preparation for this car.'}</p>
    </header>
    <ul className="vehicle-quality__list" aria-label="Vehicle quality checks">
      {checks.map(check => {
        const Icon = check.status === 'passed' ? CheckCircle2 : check.status === 'not_due' ? Clock3 : check.status === 'attention' ? Info : CircleHelp;
        return <li key={check.id} className="vehicle-quality__row">
          <span className="vehicle-quality__name">{check.label}{check.detail && <small>{check.detail}</small>}</span>
          {check.status === 'attention' ? <a className="vehicle-quality__status vehicle-quality__status--attention" href="#vehicle-history-section"><Icon className="vehicle-quality__status-icon" size={16} aria-hidden="true" />{labels[check.status]}</a> : <span className={`vehicle-quality__status vehicle-quality__status--${check.status}`}><Icon className="vehicle-quality__status-icon" size={16} aria-hidden="true" />{labels[check.status]}</span>}
        </li>;
      })}
    </ul>
    {checks.some(check => check.status === 'unknown') && <div className="vehicle-quality__footer"><p>Ask our team for the available checks and preparation details.</p>{onAskTeam ? <button type="button" onClick={() => onAskTeam('Could you confirm the vehicle checks and preparation completed on this car?')}>Ask about these checks</button> : <a href="/contact">Contact the showroom</a>}</div>}
  </section>;
}
