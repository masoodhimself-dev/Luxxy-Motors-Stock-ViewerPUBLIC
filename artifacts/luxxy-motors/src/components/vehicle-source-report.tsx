import { customerTestSession } from '@/lib/customer-test-storage';
import { useId } from 'react';
import { AlertTriangle, ExternalLink, ShieldCheck } from '@/components/icons';
import { readVehicleSourceReport, type SourceCheckStatus, type VehicleSourceReportCar } from '@/lib/vehicle-source-report';
import './vehicle-source-report.css';

const checkLabels: Record<SourceCheckStatus, string> = {
  passed: 'Passed', advisory: 'Advisory', failed: 'Issue found', unknown: 'Not confirmed',
};
const ulezLabels = {
  compliant: 'ULEZ compliant',
  not_compliant: 'Not ULEZ compliant',
  unknown: 'ULEZ status not confirmed',
};
const genericResult = /^(?:all passed|passed|pass|advisory|advisories|failed|fail|unknown|not (?:available|provided|recorded|confirmed))$/i;

export function VehicleSourceReport({ car }: { car: VehicleSourceReportCar }) {
  const detailsId = useId();
  const report = readVehicleSourceReport(car);
  if (!report) return null;
  return <section className="vehicle-source-report" aria-labelledby="vehicle-source-report-heading">
    <h2 id="vehicle-source-report-heading" className="section-heading">Vehicle checks</h2>
    {report.ulez && <div className="vehicle-source-report__ulez">
      <h3>{ulezLabels[report.ulez.status]}</h3>
      {!customerTestSession() && <a href="https://tfl.gov.uk/modes/driving/check-your-vehicle/" target="_blank" rel="noopener noreferrer">Check ULEZ status <ExternalLink size={14} /></a>}
    </div>}
    {report.history && <div className="vehicle-source-report__history">
      {report.recordedDisclosure && <aside className="vehicle-source-report__disclosure"><AlertTriangle size={20} /><div><strong>{report.recordedDisclosure.label}</strong><p>Please read the insurance history information for this vehicle.</p></div></aside>}
      <details>
        <summary aria-controls={detailsId}><ShieldCheck size={20} /><span>History checks<span className="vehicle-source-report__check-count">{report.history.checks.length} checks</span></span></summary>
        <div id={detailsId}>
          <ul className="vehicle-source-report__checks">{report.history.checks.map((check, index) => {
            const insuranceDisclosure = /write[ -]?off|written[ -]?off/i.test(check.name) ? report.recordedDisclosure : null;
            const detail = insuranceDisclosure ? insuranceDisclosure.label : genericResult.test(check.sourceText.trim()) ? null : check.sourceText;
            return <li key={`${check.name}-${index}`}>
              <div><strong>{insuranceDisclosure ? 'Insurance history' : check.name}</strong>{detail && <p>{detail}</p>}</div>
              <span className={`vehicle-source-report__status vehicle-source-report__status--${insuranceDisclosure ? 'advisory' : check.status}`}>{insuranceDisclosure ? 'See disclosure' : checkLabels[check.status]}</span>
            </li>;
          })}</ul>
        </div>
      </details>
    </div>}
  </section>;
}
