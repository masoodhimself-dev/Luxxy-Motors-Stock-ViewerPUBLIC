import type { MotHistory } from '@workspace/vehicle-meta';
import { firstMotDue } from '@/lib/long-mot';
import { motDateLabel, motMileageLabel, motTestTime, newestMotTests, passedMotMileageRows } from '@/lib/mot-mileage-history';
import { ArrowUpRight } from './icons';
import { MotMileageChart } from './mot-mileage-chart';

const formatMiles = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

export function PublicMotHistory({ history }: { history: MotHistory }) {
  const rows = passedMotMileageRows(history.tests);
  const lastPass = rows[0]?.test;
  const latest = newestMotTests(history.tests).find(test => motTestTime(test.completedDate) !== null);
  const confirmedExpiry = latest?.result === 'PASSED' && latest.expiryDate &&
    motTestTime(latest.expiryDate) !== null && latest.expiryDate.slice(0, 10) >= latest.completedDate.slice(0, 10) &&
    !history.tests.some(test => test.result === 'FAILED' && motTestTime(test.completedDate) === motTestTime(latest.completedDate))
    ? latest.expiryDate : null;
  const firstDue = firstMotDue(history);
  const nextDate = firstDue ?? confirmedExpiry;
  const car = [history.make, history.model].filter(Boolean).join(' ');

  return <div className="mot-history-results mot-history-public" data-staff={false}>
    <header className="mot-record-header">
      <div>
        <p className="mot-record-car">{car || history.registration}</p>
        <p className="mot-record-source">
          {car && <strong>{history.registration}</strong>}
          <span>DVSA record · Checked {motDateLabel(history.checkedAt)}</span>
        </p>
      </div>
      <a className="mot-official-link" href="https://www.gov.uk/check-mot-history" target="_blank" rel="noopener noreferrer">
        View full MOT history on GOV.UK<ArrowUpRight size={16} aria-hidden="true" />
      </a>
    </header>
    {(lastPass || firstDue) ? <dl className="mot-pass-summary">
      {lastPass && <div>
        <dt>Last passed MOT</dt>
        <dd><time dateTime={lastPass.completedDate}>{motDateLabel(lastPass.completedDate)}</time></dd>
      </div>}
      {nextDate && <div>
        <dt>{firstDue ? 'First MOT due' : 'MOT expiry'}</dt>
        <dd><time dateTime={nextDate}>{motDateLabel(nextDate)}</time></dd>
      </div>}
    </dl> : <p className="mot-pass-empty">No dated MOT passes were returned. This does not confirm exemption or that an MOT is not due.</p>}
    {rows.length > 0 && <>
      <MotMileageChart tests={rows.map(row => row.test)} />
      <table className="mot-pass-table">
        <caption>Passed MOT tests</caption>
        <thead>
          <tr><th scope="col">Test date</th><th scope="col">Recorded mileage</th><th scope="col">Miles added</th></tr>
        </thead>
        <tbody>
          {rows.map(({ test, addedMiles, lowerReading }, index) => <tr key={`${test.completedDate}-${index}`}>
            <th scope="row"><time dateTime={test.completedDate}>{motDateLabel(test.completedDate)}</time></th>
            <td>{motMileageLabel(test)}</td>
            <td>
              {addedMiles !== null ? <span className="mot-pass-increase" title={`${formatMiles.format(addedMiles)} miles since previous pass`}>
                <span aria-hidden="true">{addedMiles >= 1_000 ? `+${formatMiles.format(addedMiles / 1_000)}k` : addedMiles ? `+${formatMiles.format(addedMiles)}` : '0'}</span>
                <span className="sr-only">{formatMiles.format(addedMiles)} miles since previous pass</span>
              </span> : lowerReading ? <span className="mot-pass-lower">Lower reading</span> : <>
                <span aria-hidden="true">–</span><span className="sr-only">No comparable previous reading</span>
              </>}
            </td>
          </tr>)}
        </tbody>
      </table>
      <p className="mot-pass-note">Miles added compares readings from one MOT pass to the next.</p>
    </>}
  </div>;
}
