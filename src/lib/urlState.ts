/**
 * The view lives in the URL so it can be shared:
 *
 *   ?year=1700&polity=Mughal+Empire           an empire in a given year
 *   ?year=1815&event=Q48314                   an event (Wikidata id)
 *   ?year=1600&place=26.85,80.95              who ruled a spot (lat,lon)
 *   ?mode=today&country=IND                   a present-day country
 *
 * Query parameters (not paths) keep this working on static hosts like GitHub
 * Pages, which have no server to route /some/path back to the app.
 */
export type MapModeParam = 'history' | 'today';

export type UrlState = {
  mode: MapModeParam;
  year?: number;
  polity?: string;
  event?: string;
  /** [lon, lat] */
  place?: [number, number];
  /** ISO 3166-1 alpha-3, today mode */
  country?: string;
};

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const state: UrlState = { mode: params.get('mode') === 'today' ? 'today' : 'history' };

  const year = Number(params.get('year'));
  if (params.has('year') && Number.isInteger(year) && Math.abs(year) <= 10000) state.year = year;

  const polity = params.get('polity')?.trim();
  if (polity) state.polity = polity;

  const event = params.get('event')?.trim();
  if (event && /^[\w-]+$/.test(event)) state.event = event;

  const place = params.get('place')?.split(',').map(Number);
  if (place?.length === 2 && place.every(Number.isFinite)) {
    const [lat, lon] = place;
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) state.place = [lon, lat];
  }

  const country = params.get('country')?.trim().toUpperCase();
  if (country && /^[A-Z]{3}$/.test(country)) state.country = country;

  return state;
}

export function urlFor(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.mode === 'today') {
    params.set('mode', 'today');
    if (state.country) params.set('country', state.country);
  } else {
    if (state.year !== undefined) params.set('year', String(state.year));
    if (state.polity) params.set('polity', state.polity);
    if (state.event) params.set('event', state.event);
    if (state.place) params.set('place', `${state.place[1]},${state.place[0]}`);
  }
  // Commas are fine in a query string; keep "place=26.85,80.95" readable.
  const query = params.toString().replace(/%2C/gi, ',');
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

/** Updates the address bar without adding a browser-history entry. */
export function writeUrlState(state: UrlState): void {
  const next = urlFor(state);
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', next);
  }
}
