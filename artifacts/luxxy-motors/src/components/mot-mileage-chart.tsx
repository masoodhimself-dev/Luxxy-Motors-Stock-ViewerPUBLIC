import { useId, useState } from 'react';
import type { MotTest } from '@workspace/vehicle-meta';
import { AlertTriangle } from './icons';
import { buildMotMileageHistory, motDateLabel, motMileageLabel } from '@/lib/mot-mileage-history';

function chartCeiling(value: number) {
  const roughStep = Math.max(1, value / 3);
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 2.5, 5, 10].find(candidate => candidate * power >= roughStep)! * power;
  return Math.max(2, Math.ceil(value / step) * step);
}

export function MotMileageChart({ tests }: { tests: MotTest[] }) {
  const history = buildMotMileageHistory(tests);
  const headingId = useId();
  const descriptionId = useId();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = history.points.find(point => point.key === selectedKey) ?? history.points.at(-1);
  if (!selected) return <section className="mot-mileage mot-mileage-empty" aria-labelledby={headingId}>
    <h3 id={headingId}>Mileage history</h3>
    <p>No dated mileage readings are available to plot.</p>
  </section>;

  const width = 600, height = 160, inset = 9;
  const first = history.points[0], last = history.points.at(-1)!;
  const maximum = chartCeiling(Math.max(...history.points.map(point => point.miles)));
  const x = (timestamp: number) => first.timestamp === last.timestamp ? width / 2 : inset + (timestamp - first.timestamp) / (last.timestamp - first.timestamp) * (width - inset * 2);
  const y = (miles: number) => height - inset - (miles / maximum) * (height - inset * 2);
  const number = (value: number) => Math.round(value).toLocaleString('en-GB');
  const axisNumber = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  const axisDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Europe/London' });

  return <figure className="mot-mileage" aria-labelledby={headingId}>
    <div className="mot-mileage-heading"><h3 id={headingId}>Mileage history</h3><span>{history.points.length} {history.points.length === 1 ? 'reading' : 'readings'}</span></div>
    <div className="mot-mileage-selection" aria-live="polite" aria-atomic="true">
      <strong>{number(selected.miles)} miles</strong><span>{motDateLabel(selected.test.completedDate)}{selected.test.mileageUnit === 'KM' ? ` · recorded as ${motMileageLabel(selected.test)}` : ''}</span>
    </div>
    <div className="mot-mileage-plot">
      <div className="mot-mileage-axis" aria-hidden="true"><span>{axisNumber(maximum)}</span><span>{axisNumber(maximum / 2)}</span><span>0</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Recorded MOT mileage by date" aria-describedby={descriptionId}>
        {[0, maximum / 2, maximum].map(value => <line key={value} className="mot-mileage-grid" x1={0} x2={width} y1={y(value)} y2={y(value)} vectorEffect="non-scaling-stroke" aria-hidden="true" />)}
        {history.segments.filter(segment => segment.length > 1).map((segment, index) => <polyline key={index} className="mot-mileage-line" points={segment.map(point => `${x(point.timestamp)},${y(point.miles)}`).join(' ')} fill="none" vectorEffect="non-scaling-stroke" aria-hidden="true" />)}
        {history.points.map(point => <g key={point.key}>
          <circle className="mot-mileage-dot" cx={x(point.timestamp)} cy={y(point.miles)} r={point.key === selected.key ? 5 : 3.5} data-decreased={point.decreased} vectorEffect="non-scaling-stroke" aria-hidden="true" />
          <circle className="mot-mileage-target" cx={x(point.timestamp)} cy={y(point.miles)} r={12} tabIndex={0} role="button"
            aria-label={`${motDateLabel(point.test.completedDate)}: ${motMileageLabel(point.test)}${point.decreased ? ', lower than the previous reading' : ''}`}
            aria-pressed={point.key === selected.key} onClick={() => setSelectedKey(point.key)} onFocus={() => setSelectedKey(point.key)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedKey(point.key); } }} />
        </g>)}
      </svg>
    </div>
    <div className="mot-mileage-dates" aria-hidden="true">{first.timestamp === last.timestamp ? <span>{axisDate(first.timestamp)}</span> : <><span>{axisDate(first.timestamp)}</span><span>{axisDate(last.timestamp)}</span></>}</div>
    <figcaption id={descriptionId}>
      {history.points.length === 1 ? 'One recorded reading; a trend cannot be shown yet.' : 'Select a point to see its test reading.'}
      {history.convertedKm && ' Kilometre readings are converted to miles on this chart.'}
      {history.excludedCount > 0 && ' Tests without a valid date, reading or unit are not plotted.'}
    </figcaption>
    {history.hasDecrease && <p className="mot-mileage-warning"><AlertTriangle size={16} /><span>A later test records lower mileage. Check the readings with the dealership.</span></p>}
  </figure>;
}
