/**
 * Historical events from Wikidata (CC0), downloaded by scripts/build-events.mjs
 * into public/events/events.json.
 */

export const EVENT_TYPES = [
  { type: 'battle', label: 'Battles', singular: 'Battle', color: '#e2675f' },
  { type: 'war', label: 'Wars', singular: 'War', color: '#e39a45' },
  { type: 'treaty', label: 'Treaties', singular: 'Treaty', color: '#5fa3e0' },
  { type: 'political', label: 'Political', singular: 'Political event', color: '#b088e0' },
  { type: 'founding', label: 'Foundings', singular: 'City founded', color: '#5cc08a' },
  { type: 'capital', label: 'Capitals', singular: 'New capital', color: '#e0c95a' },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]['type'];

export const ALL_EVENT_TYPES: EventType[] = EVENT_TYPES.map((t) => t.type);

export const EVENT_TYPE_INFO = Object.fromEntries(EVENT_TYPES.map((t) => [t.type, t])) as Record<
  EventType,
  (typeof EVENT_TYPES)[number]
>;

export type HistoricalEvent = {
  /** Wikidata id (for capitals: city-state-year). */
  id: string;
  type: EventType;
  name: string;
  /** Year it happened or started. Negative = BCE. */
  year: number;
  /** Last year, for events that span years (wars, revolutions). */
  end?: number;
  lon: number;
  lat: number;
  /** Number of Wikipedia language editions covering it. */
  links: number;
  /**
   * Notability relative to events of the same type (1 = typical). Big cities have
   * 5-10x more Wikipedia editions than famous battles, so raw counts can't be
   * compared across types. Computed on load.
   */
  score: number;
  desc?: string;
  /** English Wikipedia article title. */
  wiki?: string;
};

type EventsFile = {
  source: string;
  sourceUrl: string;
  generated: string;
  version: string;
  counts: Partial<Record<EventType, number>>;
  events: HistoricalEvent[];
};

/** Adds `score`: each event's Wikipedia coverage divided by the median for its type. */
export function addScores(events: Omit<HistoricalEvent, 'score'>[]): HistoricalEvent[] {
  const byType = new Map<EventType, number[]>();
  for (const e of events) {
    const list = byType.get(e.type) ?? [];
    list.push(e.links);
    byType.set(e.type, list);
  }
  const median = new Map<EventType, number>();
  for (const [type, list] of byType) {
    list.sort((a, b) => a - b);
    median.set(type, Math.max(1, list[list.length >> 1]));
  }
  return events.map((e) => ({ ...e, score: e.links / (median.get(e.type) ?? 1) }));
}

export const MISSING_EVENTS_MESSAGE =
  'Event data not found. Run "npm run build:events" first (see README).';

let request: Promise<EventsFile> | null = null;

/** Loads all events once; later calls share the same download. */
export function loadEvents(): Promise<EventsFile> {
  if (!request) {
    request = fetch(`${import.meta.env.BASE_URL}events/events.json`).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? MISSING_EVENTS_MESSAGE : `Could not load events (${res.status})`);
      try {
        const file = (await res.json()) as EventsFile;
        if (!Array.isArray(file.events)) throw new Error();
        return { ...file, events: addScores(file.events) };
      } catch {
        // Dev servers answer missing files with index.html, not a 404.
        throw new Error(MISSING_EVENTS_MESSAGE);
      }
    });
    request.catch(() => {
      request = null;
    });
  }
  return request;
}

/**
 * How long a one-off event stays on the map after it happens. Sparse early eras
 * get a longer window so there is something to see; busy modern years a short one.
 */
export function afterglowYears(year: number): number {
  if (year < 0) return 30;
  if (year < 1000) return 15;
  if (year < 1800) return 8;
  return 4;
}

/** Most pins drawn at once; the most notable events win. */
export const MAX_PINS = 40;

/**
 * Events to pin on the map in `year`: ongoing ones plus recent ones within their
 * afterglow, of the enabled types, most notable first.
 */
export function eventsOnMap(
  events: HistoricalEvent[],
  year: number,
  types: ReadonlySet<EventType>,
  limit = MAX_PINS,
): HistoricalEvent[] {
  const glow = afterglowYears(year);
  const visible = events.filter(
    (e) => types.has(e.type) && e.year <= year && year <= (e.end ?? e.year) + glow,
  );
  visible.sort((a, b) => b.score - a.score);
  return visible.slice(0, limit);
}

/** 1 for an event happening now, fading towards 0.35 at the end of its afterglow. */
export function eventFreshness(event: HistoricalEvent, year: number): number {
  const last = event.end ?? event.year;
  if (year <= last) return 1;
  const age = (year - last) / afterglowYears(year);
  return Math.max(0.35, 1 - age * 0.65);
}

export function eventPinRadius(event: HistoricalEvent): number {
  // 5 px for a typical event of its type, 4 px for minor ones, up to 8 px for the most notable.
  return 4 + Math.min(4, Math.max(0, 1 + Math.log2(event.score) * 1.3));
}
