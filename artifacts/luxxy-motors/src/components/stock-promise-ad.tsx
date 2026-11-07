import './stock-promise-ad.css';

const iconStyle = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function StockPromiseAd() {
  return (
    <article className="stock-promise-ad" aria-label="What comes with every car from Multi Choice Motors">
      <div className="stock-promise-ad__heading">
        <p className="stock-promise-ad__brand">Multi Choice Motors</p>
        <svg className="stock-promise-ad__car" viewBox="0 0 256 206" {...iconStyle}>
          <path d="M43 84 65 38q6-12 20-12h85q14 0 20 13l22 45M43 84h169q17 0 17 20v42q0 10-10 10h-18v17h-25v-17H64v17H38v-19q-9-2-9-11v-37q0-22 14-22Z" />
          <path d="M31 88H19q-9 0-9-9v-5q0-9 9-9h11m183 0h12q10 0 10 10v4q0 9-10 9h-4M54 110h24m102 0h23" />
          <circle cx="203" cy="151" r="46" fill="var(--stock-promise-accent)" />
          <path d="m183 151 14 14 27-29" />
        </svg>
        <h2>What comes with every car</h2>
      </div>
      <ul className="stock-promise-ad__benefits">
        <li>
          <svg viewBox="0 0 124 168" {...iconStyle}>
            <path d="M34 24H22q-10 0-10 10v105q0 11 11 11h78q11 0 11-11V34q0-10-10-10H90" />
            <path d="M48 24v-7a14 14 0 0 1 28 0v7h14v19H34V24Z" />
            <path d="m30 68 5 5 11-12m-16 35 5 5 11-12m-16 35 5 5 11-12M62 67h30M62 95h30M62 123h30" />
          </svg>
          <p>Multi-point checks completed</p>
        </li>
        <li>
          <svg viewBox="0 0 124 168" {...iconStyle}>
            <path d="M62 9C44 23 27 29 10 34v47c0 35 23 61 52 77 29-16 52-42 52-77V34C96 29 79 23 62 9Z" />
            <path d="m36 81 20 20 36-42" />
          </svg>
          <p>6-month warranty included in the price</p>
        </li>
        <li>
          <svg viewBox="0 0 124 168" {...iconStyle}>
            <rect x="10" y="28" width="104" height="116" rx="13" />
            <path d="M36 12v33m52-33v33M12 61h100m-77 38 18 18 37-38" />
          </svg>
          <p>At least 6 months’ MOT at handover. <span>Most cars have 12 months.</span></p>
        </li>
      </ul>
    </article>
  );
}
