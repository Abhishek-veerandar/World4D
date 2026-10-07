import { ALL_EVENT_TYPES, EVENT_TYPES, type EventType } from '../lib/events';

type Props = {
  types: ReadonlySet<EventType>;
  onChange: (types: Set<EventType>) => void;
  /** How many pins of each type are on the map right now. */
  countsNow: Partial<Record<EventType, number>>;
  loading: boolean;
  error: string | null;
};

/** Toggle chips for the event types, shown over the top-left of the history map. */
export default function EventFilters({ types, onChange, countsNow, loading, error }: Props) {
  const allOn = types.size === ALL_EVENT_TYPES.length;
  const noneOn = types.size === 0;

  const toggle = (type: EventType) => {
    const next = new Set(types);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange(next);
  };

  return (
    <div className="event-filters" role="group" aria-label="Event types">
      <button
        type="button"
        className={noneOn ? 'filter-all' : 'filter-all on'}
        onClick={() => onChange(allOn ? new Set() : new Set(ALL_EVENT_TYPES))}
        aria-pressed={!noneOn}
        title={allOn ? 'Hide all events' : 'Show all events'}
      >
        Events
      </button>

      {EVENT_TYPES.map(({ type, label, color }) => {
        const on = types.has(type);
        const count = countsNow[type] ?? 0;
        return (
          <button
            key={type}
            type="button"
            className={on ? 'filter-chip on' : 'filter-chip'}
            onClick={() => toggle(type)}
            aria-pressed={on}
          >
            <span className="filter-dot" style={{ background: color }} aria-hidden="true" />
            {label}
            {on && count > 0 && <span className="filter-count">{count}</span>}
          </button>
        );
      })}

      {loading && <span className="filter-note">Loading events…</span>}
      {error && <span className="filter-note error">{error}</span>}
    </div>
  );
}
