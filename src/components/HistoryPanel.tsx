import { useMemo, useState, type ReactNode } from 'react';
import {
  colorFor,
  formatSpan,
  formatYear,
  wikipediaUrl,
  type HistoryIndex,
  type PolityFeature,
} from '../lib/history';
import { EVENT_TYPE_INFO, type HistoricalEvent } from '../lib/events';

type Props = {
  year: number;
  index: HistoryIndex | null;
  polities: PolityFeature[];
  selectedName: string | null;
  error: string | null;
  onSelect: (polity: PolityFeature) => void;
  onClear: () => void;
  onJumpTo: (year: number) => void;
  /** Pins on the map right now, most notable first. */
  eventsNow: HistoricalEvent[];
  selectedEvent: HistoricalEvent | null;
  onSelectEvent: (event: HistoricalEvent) => void;
  onClearEvent: () => void;
  /** Opens the history of the spot last clicked on the map, when there is one. */
  onSpotHistory: (() => void) | null;
};

export default function HistoryPanel({
  year,
  index,
  polities,
  selectedName,
  error,
  onSelect,
  onClear,
  onJumpTo,
  eventsNow,
  selectedEvent,
  onSelectEvent,
  onClearEvent,
  onSpotHistory,
}: Props) {
  if (error) {
    return (
      <aside className="panel">
        <p className="panel-eyebrow">History</p>
        <h2>Data missing</h2>
        <p className="panel-hint">{error}</p>
      </aside>
    );
  }

  return (
    <aside className="panel">
      {selectedEvent ? (
        <EventDetails event={selectedEvent} year={year} onClear={onClearEvent} onJumpTo={onJumpTo} />
      ) : selectedName ? (
        <PolityDetails
          name={selectedName}
          year={year}
          index={index}
          current={polities.find((p) => p.properties.name === selectedName) ?? null}
          onClear={onClear}
          onJumpTo={onJumpTo}
          onSpotHistory={onSpotHistory}
        />
      ) : (
        <PolityList year={year} polities={polities} onSelect={onSelect}>
          {eventsNow.length > 0 && (
            <EventList year={year} events={eventsNow} onSelect={onSelectEvent} />
          )}
        </PolityList>
      )}

      <p className="attribution">
        Historical borders:{' '}
        <a
          href={index?.sourceUrl ?? 'https://github.com/Seshat-Global-History-Databank/cliopatria'}
          target="_blank"
          rel="noreferrer"
        >
          Cliopatria
        </a>{' '}
        (Seshat Global History Databank), CC BY 4.0, simplified. Borders are approximate,
        especially for ancient periods. Events:{' '}
        <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">
          Wikidata
        </a>{' '}
        (CC0); some locations are approximate.
      </p>
    </aside>
  );
}

function PolityList({
  year,
  polities,
  onSelect,
  children,
}: {
  year: number;
  polities: PolityFeature[];
  onSelect: (polity: PolityFeature) => void;
  /** Shown between the intro and the polity list (the events around this year). */
  children?: ReactNode;
}) {
  const [query, setQuery] = useState('');

  // Largest first: the big empires are usually what people look for.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...polities].sort((a, b) => b.properties.area - a.properties.area);
    return q ? sorted.filter((p) => p.properties.name.toLowerCase().includes(q)) : sorted;
  }, [polities, query]);

  return (
    <>
      <p className="panel-eyebrow">The world in</p>
      <h2>{formatYear(year)}</h2>
      <p className="panel-hint">
        Drag the timeline or press play to watch borders change. Click any territory to follow
        it through time, or a dot to see what happened there. Right-click (or press and hold) any
        spot to see everyone who ruled it.
      </p>

      {children}

      <section className="region-list">
        <h3>
          On the map
          <span className="count">{polities.length}</span>
        </h3>
        {polities.length > 10 && (
          <input
            className="list-filter"
            type="search"
            placeholder="Filter by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {polities.length === 0 ? (
          <p className="muted">No mapped polities for this year.</p>
        ) : (
          <ul>
            {visible.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onSelect(p)}>
                  <span
                    className="swatch"
                    style={{ background: colorFor(p.properties.name) }}
                    aria-hidden="true"
                  />
                  {p.properties.name}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="muted">No matches.</li>}
          </ul>
        )}
      </section>
    </>
  );
}

function PolityDetails({
  name,
  year,
  index,
  current,
  onClear,
  onJumpTo,
  onSpotHistory,
}: {
  name: string;
  year: number;
  index: HistoryIndex | null;
  current: PolityFeature | null;
  onClear: () => void;
  onJumpTo: (year: number) => void;
  onSpotHistory: (() => void) | null;
}) {
  const lifespan = index?.lifespans[name];
  const props = current?.properties;

  return (
    <>
      <p className="panel-eyebrow">Polity</p>
      <h2 className="polity-title">
        <span className="swatch large" style={{ background: colorFor(name) }} aria-hidden="true" />
        {name}
      </h2>

      {!current && (
        <p className="notice">
          Not on the map in {formatYear(year)}.
          {lifespan && (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => onJumpTo(lifespan[0])}>
                Jump to {formatYear(lifespan[0])}
              </button>
            </>
          )}
        </p>
      )}

      <dl className="stats">
        {lifespan && (
          <div>
            <dt>Existed</dt>
            <dd>{formatSpan(lifespan[0], lifespan[1])}</dd>
          </div>
        )}
        {props && (
          <>
            <div>
              <dt>These borders</dt>
              <dd>{formatSpan(props.from, props.to)}</dd>
            </div>
            <div>
              <dt>Area in {formatYear(year)}</dt>
              <dd>{props.area > 0 ? `${props.area.toLocaleString()} km²` : '—'}</dd>
            </div>
            {props.memberOf && (
              <div>
                <dt>Part of</dt>
                <dd>{props.memberOf.join(', ')}</dd>
              </div>
            )}
          </>
        )}
      </dl>

      {lifespan && (
        <div className="jump-row">
          <button type="button" className="clear-btn" onClick={() => onJumpTo(lifespan[0])}>
            Go to start
          </button>
          <button type="button" className="clear-btn" onClick={() => onJumpTo(lifespan[1])}>
            Go to end
          </button>
        </div>
      )}

      {props?.wikipedia && (
        <a
          className="wiki-link"
          href={wikipediaUrl(props.wikipedia)}
          target="_blank"
          rel="noreferrer"
        >
          Read about it on Wikipedia ↗
        </a>
      )}

      {onSpotHistory && (
        <button type="button" className="clear-btn accent" onClick={onSpotHistory}>
          Who else ruled this spot?
        </button>
      )}

      <button type="button" className="clear-btn" onClick={onClear}>
        Back to all polities
      </button>
    </>
  );
}

function EventList({
  year,
  events,
  onSelect,
}: {
  year: number;
  events: HistoricalEvent[];
  onSelect: (event: HistoricalEvent) => void;
}) {
  return (
    <section className="region-list">
      <h3>
        Events around {formatYear(year)}
        <span className="count">{events.length}</span>
      </h3>
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onSelect(e)}>
              <span
                className="swatch round"
                style={{ background: EVENT_TYPE_INFO[e.type].color }}
                aria-hidden="true"
              />
              <span className="event-row-name">{e.name}</span>
              <span className="event-row-year">{formatYear(e.year)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventDetails({
  event,
  year,
  onClear,
  onJumpTo,
}: {
  event: HistoricalEvent;
  year: number;
  onClear: () => void;
  onJumpTo: (year: number) => void;
}) {
  const info = EVENT_TYPE_INFO[event.type];
  const when = event.end ? formatSpan(event.year, event.end) : formatYear(event.year);
  const isNow = event.year <= year && year <= (event.end ?? event.year);

  return (
    <>
      <p className="panel-eyebrow" style={{ color: info.color }}>
        {info.singular}
      </p>
      <h2>{event.name}</h2>
      {event.desc && <p className="panel-hint">{event.desc}</p>}

      <dl className="stats">
        <div>
          <dt>When</dt>
          <dd>{when}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>
            {Math.abs(event.lat).toFixed(2)}° {event.lat >= 0 ? 'N' : 'S'},{' '}
            {Math.abs(event.lon).toFixed(2)}° {event.lon >= 0 ? 'E' : 'W'}
          </dd>
        </div>
      </dl>

      {!isNow && (
        <div className="jump-row">
          <button type="button" className="clear-btn" onClick={() => onJumpTo(event.year)}>
            Go to {formatYear(event.year)}
          </button>
        </div>
      )}

      {event.wiki && (
        <a className="wiki-link" href={wikipediaUrl(event.wiki)} target="_blank" rel="noreferrer">
          Read about it on Wikipedia ↗
        </a>
      )}

      <button type="button" className="clear-btn" onClick={onClear}>
        Close
      </button>
    </>
  );
}
