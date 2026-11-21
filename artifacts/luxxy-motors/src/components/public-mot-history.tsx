import { Fragment, useId, useRef, useState } from 'react';
import { addMonths, differenceInCalendarDays, differenceInMonths } from 'date-fns';
import type { MotHistory } from '@workspace/vehicle-meta';
import { firstMotDue, ukToday } from '@/lib/long-mot';
import { buildMotMileageHistory, motDateLabel, motMileageLabel, motTestTime, newestMotTests, passedMotMileageRows } from '@/lib/mot-mileage-history';
import { ArrowUpRight, ChevronDown, Copy } from './icons';
import { MotMileageChart } from './mot-mileage-chart';

const formatMiles = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const formatInterval = new Intl.ListFormat('en-GB', { type: 'conjunction' });
const recentTestCount = 5;

function expiryNotice(days: number) {
  if (days < 0) return 'Expired';
  if (days === 0) return 'Due today';
  if (days <= 30) return `Due in ${days} ${days === 1 ? 'day' : 'days'}`;
  return null;
}

function timeBetweenPasses(previous: string, next: string) {
  const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`);
  const start = date(previous);
  const end = date(next);
  const months = differenceInMonths(end, start);
  const days = differenceInCalendarDays(end, addMonths(start, months));
  return formatInterval.format([
    ...(months ? [`${months} ${months === 1 ? 'month' : 'months'}`] : []),
    ...(days ? [`${days} ${days === 1 ? 'day' : 'days'}`] : []),
  ]);
}

export function PublicMotHistory({ history, advertisedMileage }: {
  history: MotHistory;
  advertisedMileage?: number | null;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const [showOlderTests, setShowOlderTests] = useState(false);
  const [selectedDelta, setSelectedDelta] = useState<number | null>(null);
  const registration = useRef<HTMLElement>(null);
  const testsId = useId();
  const rows = passedMotMileageRows(history.tests);
  const lastPass = rows[0]?.test;
  const latest = newestMotTests(history.tests).find(test => motTestTime(test.completedDate) !== null);
  const now = new Date();
  const today = ukToday(now);
  const confirmedExpiry = latest?.result === 'PASSED' && latest.expiryDate &&
    motTestTime(latest.expiryDate) !== null && latest.expiryDate.slice(0, 10) >= latest.completedDate.slice(0, 10) &&
    latest.completedDate.slice(0, 10) <= today &&
    !history.tests.some(test => test.result === 'FAILED' && motTestTime(test.completedDate) === motTestTime(latest.completedDate))
    ? latest.expiryDate : null;
  const firstDue = firstMotDue(history, now);
  const nextDate = firstDue ?? confirmedExpiry;
  const notice = nextDate ? expiryNotice((Date.parse(nextDate.slice(0, 10)) - Date.parse(today)) / 86_400_000) : null;
  const datedPasses = rows.map(row => row.test);
  const latestMileage = buildMotMileageHistory(datedPasses).points.at(-1);
  const displayedAdvertMileage = typeof advertisedMileage === 'number' && Number.isFinite(advertisedMileage) && advertisedMileage >= 0
    ? advertisedMileage : null;
  const advertIsLower = latestMileage && displayedAdvertMileage !== null && displayedAdvertMileage < Math.round(latestMileage.miles);
  const mileageRose = rows.length >= 3 && lastPass && lastPass.completedDate.slice(0, 10) <= today &&
    rows.length === history.tests.filter(test => test.result === 'PASSED').length &&
    rows.slice(0, -1).every(({ addedMiles }) => addedMiles !== null && addedMiles > 0) &&
    !buildMotMileageHistory(history.tests).hasDecrease;
  const car = [history.make, history.model].filter(Boolean).join(' ');
  const olderTestsCount = rows.length - recentTestCount;

  async function copyRegistration() {
    try {
      await navigator.clipboard.writeText(history.registration);
      setCopyStatus('Registration copied');
    } catch {
      if (registration.current) window.getSelection()?.selectAllChildren(registration.current);
      setCopyStatus('Select and copy the registration shown above.');
    }
  }

  return <div className="mot-history-results mot-history-public" data-staff={false}>
    <header className="mot-record-header">
      <div>
        {car && <p className="mot-record-car">{car}</p>}
        <p className="mot-record-source">
          <strong ref={registration}>{history.registration}</strong>
          <span>DVSA record · Checked {motDateLabel(history.checkedAt)}</span>
        </p>
      </div>
      <div className="mot-record-actions">
        {history.registration && <button type="button" className="mot-copy-registration" onClick={() => void copyRegistration()}>
          <Copy size={15} aria-hidden="true" />Copy registration
        </button>}
        <a className="mot-official-link" aria-label="View full MOT history on GOV.UK" href="https://www.gov.uk/check-mot-history" target="_blank" rel="noopener noreferrer">
          Full MOT history on GOV.UK<ArrowUpRight size={16} aria-hidden="true" />
        </a>
        <span role="status" className="mot-copy-status">{copyStatus}</span>
      </div>
    </header>
    {(lastPass || nextDate || displayedAdvertMileage !== null) && <dl className="mot-pass-summary">
      {nextDate && <div>
        <dt>{firstDue ? 'First MOT due' : 'MOT expiry'}</dt>
        <dd><time dateTime={nextDate}>{motDateLabel(nextDate)}</time></dd>
        {notice && <dd className="mot-summary-detail" data-expired={notice === 'Expired'}>{notice}</dd>}
      </div>}
      {lastPass && <div>
        <dt>Last passed MOT</dt>
        <dd><time dateTime={lastPass.completedDate}>{motDateLabel(lastPass.completedDate)}</time></dd>
      </div>}
      {latestMileage && <div>
        <dt>Latest MOT pass mileage</dt>
        <dd>{motMileageLabel(latestMileage.test)}</dd>
        <dd className="mot-summary-detail"><time dateTime={latestMileage.test.completedDate}>{motDateLabel(latestMileage.test.completedDate)}</time></dd>
      </div>}
      {displayedAdvertMileage !== null && <div>
        <dt>Advertised mileage</dt>
        <dd>{formatMiles.format(displayedAdvertMileage)} miles</dd>
      </div>}
    </dl>}
    {advertIsLower && <p className="mot-mileage-discrepancy">The advertised mileage is lower than the latest MOT reading. Ask the dealership to confirm the current mileage.</p>}
    {!lastPass && !firstDue && <p className="mot-pass-empty">No dated MOT passes were returned. This does not confirm exemption or that an MOT is not due.</p>}
    {rows.length > 0 && <>
      <MotMileageChart tests={datedPasses} readingControls trend={mileageRose ? 'Recorded mileage rose with each successive MOT pass.' : undefined} />
      <table className="mot-pass-table">
        <caption>Passed MOT tests</caption>
        <thead>
          <tr><th scope="col">Test date</th><th scope="col">Recorded mileage</th><th scope="col">Miles added</th></tr>
        </thead>
        <tbody id={testsId} data-expanded={showOlderTests}>
          {rows.map(({ test, addedMiles, lowerReading }, index) => {
            const isOlder = index >= recentTestCount;
            const previousTest = rows[index + 1]?.test;
            const deltaLabel = addedMiles === null ? null : `${formatMiles.format(addedMiles)} miles since previous pass`;
            const expanded = selectedDelta === index;
            return <Fragment key={`${test.completedDate}-${index}`}>
              <tr data-older={isOlder}>
                <th scope="row"><time dateTime={test.completedDate}>{motDateLabel(test.completedDate)}</time></th>
                <td>{motMileageLabel(test)}</td>
                <td>
                  {addedMiles !== null ? <button type="button" className="mot-pass-increase" aria-expanded={expanded}
                    aria-controls={expanded ? `${testsId}-${index}` : undefined} onClick={() => setSelectedDelta(expanded ? null : index)}>
                    <span aria-hidden="true">{addedMiles >= 1_000 ? `+${formatMiles.format(addedMiles / 1_000)}k` : addedMiles ? `+${formatMiles.format(addedMiles)}` : '0'}</span>
                    <span className="sr-only">{deltaLabel}</span>
                  </button> : lowerReading ? <span className="mot-pass-lower">Lower reading</span> : <>
                    <span aria-hidden="true">–</span><span className="sr-only">No comparable previous reading</span>
                  </>}
                </td>
              </tr>
              {expanded && addedMiles !== null && previousTest && <tr id={`${testsId}-${index}`} data-older={isOlder} className="mot-pass-interval">
                <td colSpan={3}>{formatMiles.format(addedMiles)} miles over {timeBetweenPasses(previousTest.completedDate, test.completedDate)}</td>
              </tr>}
            </Fragment>;
          })}
        </tbody>
      </table>
      {olderTestsCount > 0 && <button type="button" className="mot-toggle-tests" aria-controls={testsId} aria-expanded={showOlderTests}
        onClick={() => {
          if (showOlderTests && selectedDelta !== null && selectedDelta >= recentTestCount) setSelectedDelta(null);
          setShowOlderTests(!showOlderTests);
        }}>
        {showOlderTests ? 'Hide older tests' : `Show all ${rows.length} tests`}<ChevronDown size={16} aria-hidden="true" />
      </button>}
      {rows.some(row => row.addedMiles !== null) && <p className="mot-pass-note">Select a mileage change to see the distance and time between passes.</p>}
    </>}
  </div>;
}
