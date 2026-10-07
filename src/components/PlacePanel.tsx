import { colorFor, formatSpan, formatYear, type Reign } from '../lib/history';

export type PlaceState =
  | { status: 'loading'; done: number; total: number }
  | { status: 'ready'; reigns: Reign[] }
  | { status: 'error'; message: string };

type Props = {
  place: [number, number];
  /** Present-day country the spot is in, if any. */
  countryToday: string | null;
  state: PlaceState;
  year: number;
  /** The timeline's range, for the overview bar. */
  min: number;
  max: number;
  onPickReign: (reign: Reign) => void;
  onClose: () => void;
};

/** Gaps shorter than this between reigns aren't worth a row of their own. */
const MIN_GAP_YEARS = 20;

function formatCoords([lon, lat]: [number, number]) {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
}

function years(n: number) {
  return n === 1 ? '1 year' : `${n.toLocaleString()} years`;
}

/** "Who ruled this spot?": every polity that held it, oldest first. */
export default function PlacePanel({ place, countryToday, state, year, min, max, onPickReign, onClose }: Props) {
  return (
    <>
      <p className="panel-eyebrow">History of this place</p>
      <h2>{countryToday ? `In present-day ${countryToday}` : 'Outside any country today'}</h2>
      <p className="panel-hint">{formatCoords(place)}</p>

      {state.status === 'loading' && (
        <div className="place-progress" role="status">
          <div className="place-progress-bar">
            <span style={{ width: `${state.total ? (state.done / state.total) * 100 : 0}%` }} />
          </div>
          <p className="muted">
            Checking every century… {state.total ? `${state.done} of ${state.total}` : ''}
          </p>
        </div>
      )}

      {state.status === 'error' && <p className="muted">Couldn&apos;t look this up: {state.message}</p>}

      {state.status === 'ready' && state.reigns.length === 0 && (
        <p className="muted">No mapped state has held this spot. It may be sea, or a region the data doesn&apos;t cover.</p>
      )}

      {state.status === 'ready' && state.reigns.length > 0 && (
        <ReignList reigns={state.reigns} year={year} min={min} max={max} onPick={onPickReign} />
      )}

      <button type="button" className="clear-btn" onClick={onClose}>
        Close
      </button>
    </>
  );
}

function ReignList({
  reigns,
  year,
  min,
  max,
  onPick,
}: {
  reigns: Reign[];
  year: number;
  min: number;
  max: number;
  onPick: (reign: Reign) => void;
}) {
  const span = max - min;
  const pct = (y: number) => `${((Math.min(max, Math.max(min, y)) - min) / span) * 100}%`;
  const first = reigns[0].from;

  // Rows: reigns, plus a note wherever nobody is mapped for a while.
  const rows: ({ kind: 'reign'; reign: Reign } | { kind: 'gap'; from: number; to: number })[] = [];
  let coveredUntil = -Infinity;
  for (const reign of reigns) {
    if (coveredUntil > -Infinity && reign.from - coveredUntil > MIN_GAP_YEARS) {
      rows.push({ kind: 'gap', from: coveredUntil + 1, to: reign.from - 1 });
    }
    rows.push({ kind: 'reign', reign });
    coveredUntil = Math.max(coveredUntil, reign.to);
  }

  return (
    <section className="place-history">
      <div className="reign-bar" aria-hidden="true">
        {reigns.map((r, i) => (
          <span
            key={`${r.name}-${r.from}-${i}`}
            className="reign-seg"
            style={{
              left: pct(r.from),
              width: `calc(${pct(r.to + 1)} - ${pct(r.from)})`,
              background: colorFor(r.name),
            }}
            title={`${r.name} (${formatSpan(r.from, r.to)})`}
          />
        ))}
        <span className="reign-cursor" style={{ left: pct(year) }} />
      </div>
      <div className="timeline-scale" aria-hidden="true">
        <span>{formatYear(min)}</span>
        <span>{formatYear(max)}</span>
      </div>

      <h3>
        {reigns.length} {reigns.length === 1 ? 'ruler' : 'rulers'} since {formatYear(first)}
      </h3>
      <ol className="reign-list">
        {rows.map((row, i) =>
          row.kind === 'gap' ? (
            <li key={`gap-${i}`} className="reign-gap">
              No mapped state · {formatSpan(row.from, row.to)}
            </li>
          ) : (
            <li key={`${row.reign.name}-${row.reign.from}-${i}`}>
              <button
                type="button"
                className={row.reign.from <= year && year <= row.reign.to ? 'reign current' : 'reign'}
                onClick={() => onPick(row.reign)}
              >
                <span className="swatch" style={{ background: colorFor(row.reign.name) }} aria-hidden="true" />
                <span className="reign-text">
                  <span className="reign-name">{row.reign.name}</span>
                  <span className="reign-years">
                    {formatSpan(row.reign.from, row.reign.to)} · {years(row.reign.to - row.reign.from + 1)}
                  </span>
                </span>
              </button>
            </li>
          ),
        )}
      </ol>
      <p className="attribution">
        From Cliopatria&apos;s borders. Where claims overlapped, more than one ruler is listed for the same years.
      </p>
    </section>
  );
}
