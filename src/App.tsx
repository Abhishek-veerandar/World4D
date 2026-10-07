import { useCallback, useEffect, useMemo, useState } from 'react';
import WorldMap, { type MapMode } from './components/WorldMap';
import DetailsPanel from './components/DetailsPanel';
import HistoryPanel from './components/HistoryPanel';
import Timeline, { type Speed } from './components/Timeline';
import type { Crumb } from './components/Breadcrumb';
import EventFilters from './components/EventFilters';
import SearchBox from './components/SearchBox';
import PlacePanel, { type PlaceState } from './components/PlacePanel';
import ShareButton from './components/ShareButton';
import { geoContains } from 'd3-geo';
import { borders, countries, land, type CountryFeature } from './lib/countries';
import { regionsWithin, type RegionFeature } from './lib/regions';
import type { Point } from 'geojson';
import { placeHistory, type PolityFeature, type Reign } from './lib/history';
import { readUrlState, writeUrlState } from './lib/urlState';
import {
  afterglowYears,
  ALL_EVENT_TYPES,
  eventsOnMap,
  type EventType,
  type HistoricalEvent,
} from './lib/events';
import { useRegions } from './hooks/useRegions';
import { useHistory } from './hooks/useHistory';
import { useEvents } from './hooks/useEvents';

/** The timeline's range. The data itself reaches back to 3400 BCE. */
const START_YEAR = -2000;
const END_YEAR = 2024;
const DEFAULT_YEAR = 1;

/** Today mode drill-down: World → Country → State / province → District. */
type TodaySelection = {
  countryId: string | null;
  regionId: string | null;
  subregionId: string | null;
};

const WORLD: TodaySelection = { countryId: null, regionId: null, subregionId: null };

/** A polity followed through time. `focus` is its shape when picked, for the camera. */
type PolitySelection = { name: string; focus: PolityFeature } | null;

const FILTERS_KEY = 'world4d.eventTypes';

/** The event types the viewer last had switched on; everything on by default. */
function loadSavedTypes(): Set<EventType> {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? 'null');
    if (Array.isArray(saved)) return new Set(saved.filter((t) => ALL_EVENT_TYPES.includes(t)));
  } catch {
    // Storage unavailable or corrupt: fall back to the default.
  }
  return new Set(ALL_EVENT_TYPES);
}

export default function App() {
  // The URL can open the app on a specific view (see lib/urlState.ts).
  const [initial] = useState(readUrlState);

  const [mode, setMode] = useState<MapMode>(initial.mode);

  // ---------- history mode ----------

  const [year, setYear] = useState(
    initial.year !== undefined ? Math.min(END_YEAR, Math.max(START_YEAR, initial.year)) : DEFAULT_YEAR,
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(20);
  const [polity, setPolity] = useState<PolitySelection>(null);

  const history = useHistory(year, mode === 'history');
  const endYear = Math.min(END_YEAR, history.index?.maxYear ?? END_YEAR);

  // Playback: advance on a fixed tick, but hold still while the next chunk downloads.
  useEffect(() => {
    if (!playing || mode !== 'history' || history.loading) return;
    const id = window.setInterval(() => {
      setYear((y) => Math.min(endYear, Math.round(y + speed / 10)));
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, mode, history.loading, speed, endYear]);

  useEffect(() => {
    if (year >= endYear) setPlaying(false);
  }, [year, endYear]);

  const togglePlay = useCallback(() => {
    // Pressing play at the very end starts again from the beginning.
    if (!playing && year >= endYear) setYear(START_YEAR);
    setPlaying(!playing);
  }, [playing, year, endYear]);

  const changeYear = useCallback((y: number) => {
    setPlaying(false);
    setYear(y);
  }, []);

  const selectPolity = useCallback((p: PolityFeature) => {
    setPolity({ name: p.properties.name, focus: p });
  }, []);

  const clearPolity = useCallback(() => setPolity(null), []);

  // ---------- events ----------

  const [eventTypes, setEventTypes] = useState<Set<EventType>>(loadSavedTypes);
  const [selectedEvent, setSelectedEvent] = useState<HistoricalEvent | null>(null);
  const eventsState = useEvents(mode === 'history');

  const changeEventTypes = useCallback((types: Set<EventType>) => {
    setEventTypes(types);
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify([...types]));
    } catch {
      // Not saved; the choice still applies for this visit.
    }
  }, []);

  // Events of the enabled types, for the density strip under the map.
  const typedEvents = useMemo(
    () => eventsState.events.filter((e) => eventTypes.has(e.type)),
    [eventsState.events, eventTypes],
  );

  // Pins for the current year, plus the selected event even if it is not "current".
  const pins = useMemo(() => {
    const list = eventsOnMap(typedEvents, year, eventTypes);
    if (selectedEvent && !list.some((e) => e.id === selectedEvent.id)) list.push(selectedEvent);
    return list;
  }, [typedEvents, year, eventTypes, selectedEvent]);

  const pinCounts = useMemo(() => {
    const counts: Partial<Record<EventType, number>> = {};
    for (const e of pins) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return counts;
  }, [pins]);

  const selectEvent = useCallback(
    (e: HistoricalEvent) => {
      setPolity(null);
      setPlace(null);
      setSelectedEvent(e);
      // Bring the timeline to the event unless it is already showing.
      const showing = e.year <= year && year <= (e.end ?? e.year) + afterglowYears(year);
      if (!showing) changeYear(e.year);
    },
    [year, changeYear],
  );

  const clearEvent = useCallback(() => setSelectedEvent(null), []);

  // Picking a polity and an event are exclusive: the panel shows one at a time.
  const selectPolityOnly = useCallback(
    (p: PolityFeature, at: [number, number] | null = null) => {
      setSelectedEvent(null);
      setPlace(null);
      setLastClick(at);
      selectPolity(p);
    },
    [selectPolity],
  );


  // A polity picked in search is selected once its century has loaded.
  const [pendingPolity, setPendingPolity] = useState<string | null>(initial.polity ?? null);
  useEffect(() => {
    if (!pendingPolity || history.loading) return;
    const match = history.polities.find((p) => p.properties.name === pendingPolity);
    if (match) {
      setSelectedEvent(null);
      setPolity({ name: match.properties.name, focus: match });
    }
    setPendingPolity(null);
  }, [pendingPolity, history.polities, history.loading]);

  // An event in the URL is selected once the event list has loaded.
  const [pendingEvent, setPendingEvent] = useState<string | null>(initial.event ?? null);
  useEffect(() => {
    if (!pendingEvent || eventsState.events.length === 0) return;
    const match = eventsState.events.find((e) => e.id === pendingEvent);
    if (match) {
      setSelectedEvent(match);
      setEventTypes((types) => (types.has(match.type) ? types : new Set([...types, match.type])));
    }
    setPendingEvent(null);
  }, [pendingEvent, eventsState.events]);

  // ---------- who ruled this spot ----------

  const [place, setPlace] = useState<[number, number] | null>(initial.place ?? null);
  const [placeState, setPlaceState] = useState<PlaceState | null>(null);
  /** Where the user last clicked a polity, for its "who else ruled this spot?" button. */
  const [lastClick, setLastClick] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!place || !history.index) return;
    let cancelled = false;
    setPlaceState({ status: 'loading', done: 0, total: history.index.chunks.length });
    placeHistory(history.index, place[0], place[1], (done, total) => {
      if (!cancelled) setPlaceState({ status: 'loading', done, total });
    })
      .then((reigns) => !cancelled && setPlaceState({ status: 'ready', reigns }))
      .catch(
        (e: unknown) =>
          !cancelled && setPlaceState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [place, history.index]);

  const countryToday = useMemo(
    () => (place ? (countries.find((c) => geoContains(c, place))?.properties.name ?? null) : null),
    [place],
  );

  const pickPlace = useCallback((at: [number, number]) => {
    setSelectedEvent(null);
    setPlace(at);
  }, []);

  const closePlace = useCallback(() => {
    setPlace(null);
    setPlaceState(null);
  }, []);

  /** Esc in history mode: close the event, then the place, then the polity. */
  const historyBack = useCallback(() => {
    if (selectedEvent) setSelectedEvent(null);
    else if (place) closePlace();
    else setPolity(null);
  }, [selectedEvent, place, closePlace]);

  /** Ocean click / reset button: clear everything and zoom out. */
  const historyReset = useCallback(() => {
    setSelectedEvent(null);
    closePlace();
    setPolity(null);
  }, [closePlace]);

  /** From the place panel: go to that ruler's time and highlight it, keeping the panel open. */
  const pickReign = useCallback(
    (reign: Reign) => {
      if (year < reign.from || year > reign.to) changeYear(reign.from);
      setPendingPolity(reign.name);
    },
    [year, changeYear],
  );

  // ---------- today mode ----------

  const [selection, setSelection] = useState<TodaySelection>(() => {
    const c = initial.country ? countries.find((x) => x.iso3 === initial.country) : undefined;
    return c ? { countryId: c.id, regionId: null, subregionId: null } : WORLD;
  });
  const isToday = mode === 'today';

  const country = useMemo(
    () => countries.find((c) => c.id === selection.countryId) ?? null,
    [selection.countryId],
  );

  // States / provinces load as soon as a country is picked.
  const regionsState = useRegions(isToday ? (country?.iso3 ?? null) : null, 'ADM1');
  const region = useMemo(
    () => regionsState.regions.find((r) => r.id === selection.regionId) ?? null,
    [regionsState.regions, selection.regionId],
  );

  // Districts load once a state is picked; the file covers the whole country,
  // so keep only the districts inside the chosen state.
  const subregionsState = useRegions(
    isToday && region ? (country?.iso3 ?? null) : null,
    'ADM2',
  );
  const subregions = useMemo(
    () => (region ? regionsWithin(region, subregionsState.regions) : []),
    [region, subregionsState.regions],
  );
  const subregion = useMemo(
    () => subregions.find((r) => r.id === selection.subregionId) ?? null,
    [subregions, selection.subregionId],
  );

  const selectCountry = useCallback((c: CountryFeature) => {
    setSelection({ countryId: c.id, regionId: null, subregionId: null });
  }, []);

  const selectRegion = useCallback((r: RegionFeature) => {
    setSelection((s) => ({ ...s, regionId: r.id, subregionId: null }));
  }, []);

  const selectSubregion = useCallback((r: RegionFeature) => {
    setSelection((s) => ({ ...s, subregionId: r.id }));
  }, []);

  const goUpToday = useCallback(() => {
    setSelection((s) => {
      if (s.subregionId) return { ...s, subregionId: null };
      if (s.regionId) return { ...s, regionId: null };
      return WORLD;
    });
  }, []);

  const crumbs = useMemo<Crumb[]>(() => {
    if (!isToday) return [];
    const list: Crumb[] = [{ label: 'World', onClick: () => setSelection(WORLD) }];
    if (country) {
      list.push({
        label: country.properties.name,
        onClick: () => setSelection({ countryId: country.id, regionId: null, subregionId: null }),
      });
    }
    if (region) {
      list.push({
        label: region.properties.shapeName,
        onClick: () => setSelection((s) => ({ ...s, subregionId: null })),
      });
    }
    if (subregion) list.push({ label: subregion.properties.shapeName });
    return list;
  }, [isToday, country, region, subregion]);

  // ---------- shared ----------

  const switchMode = (next: MapMode) => {
    setPlaying(false);
    setMode(next);
  };

  const loadingLabel = isToday
    ? regionsState.status === 'loading'
      ? 'Loading states & provinces…'
      : subregionsState.status === 'loading'
        ? 'Loading districts…'
        : null
    : history.loading
      ? 'Loading history…'
      : null;

  const eventFocus = useMemo<Point | null>(
    () => (selectedEvent ? { type: 'Point', coordinates: [selectedEvent.lon, selectedEvent.lat] } : null),
    [selectedEvent],
  );

  const placeFocus = useMemo<Point | null>(
    () => (place ? { type: 'Point', coordinates: place } : null),
    [place],
  );

  const focus = isToday
    ? (subregion ?? region ?? country)
    : (eventFocus ?? placeFocus ?? polity?.focus ?? null);

  // Keep the address bar in step with the view, so it can be shared. Skipped while
  // playing (the year changes ten times a second); written when playback stops.
  useEffect(() => {
    if (playing) return;
    writeUrlState({
      mode,
      year,
      polity: pendingPolity ?? polity?.name,
      event: pendingEvent ?? selectedEvent?.id,
      place: place ?? undefined,
      country: country?.iso3 ?? undefined,
    });
  }, [playing, mode, year, pendingPolity, polity, pendingEvent, selectedEvent, place, country]);

  // ---------- search ----------

  const pickPolity = useCallback((name: string, from: number) => {
    setMode('history');
    setPlaying(false);
    setSelectedEvent(null);
    setPlace(null);
    setPolity(null);
    setYear(from);
    setPendingPolity(name);
  }, []);

  const pickEvent = useCallback((e: HistoricalEvent) => {
    setMode('history');
    setPlaying(false);
    setPolity(null);
    setPlace(null);
    setSelectedEvent(e);
    setYear(e.year);
    // Make sure the picked event's type is visible.
    setEventTypes((types) => (types.has(e.type) ? types : new Set([...types, e.type])));
  }, []);

  const pickCountry = useCallback((c: CountryFeature) => {
    setMode('today');
    setPlaying(false);
    setSelection({ countryId: c.id, regionId: null, subregionId: null });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          World<span>4D</span>
        </h1>
        <SearchBox
          countries={countries}
          onPickPolity={pickPolity}
          onPickEvent={pickEvent}
          onPickCountry={pickCountry}
        />
        <ShareButton />
        <nav className="mode-switch" aria-label="Map mode">
          <button
            type="button"
            className={mode === 'history' ? 'active' : ''}
            onClick={() => switchMode('history')}
            aria-pressed={mode === 'history'}
          >
            History
          </button>
          <button
            type="button"
            className={mode === 'today' ? 'active' : ''}
            onClick={() => switchMode('today')}
            aria-pressed={mode === 'today'}
          >
            Today
          </button>
        </nav>
      </header>

      <main className="app-main">
        <div className="map-column">
          <WorldMap
            mode={mode}
            focus={focus}
            loadingLabel={loadingLabel}
            crumbs={crumbs}
            onReset={isToday ? () => setSelection(WORLD) : historyReset}
            onBack={isToday ? goUpToday : historyBack}
            land={land}
            polities={history.polities}
            selectedPolityName={polity?.name ?? null}
            onSelectPolity={selectPolityOnly}
            onPickPlace={pickPlace}
            place={place}
            events={pins}
            year={year}
            selectedEventId={selectedEvent?.id ?? null}
            onSelectEvent={selectEvent}
            countries={countries}
            borders={borders}
            regions={regionsState.regions}
            subregions={subregions}
            selectedCountryId={selection.countryId}
            selectedRegionId={region?.id ?? null}
            selectedSubregionId={subregion?.id ?? null}
            onSelectCountry={selectCountry}
            onSelectRegion={selectRegion}
            onSelectSubregion={selectSubregion}
          >
            {!isToday && (
              <EventFilters
                types={eventTypes}
                onChange={changeEventTypes}
                countsNow={pinCounts}
                loading={eventsState.loading}
                error={eventsState.error}
              />
            )}
          </WorldMap>
          {!isToday && (
            <Timeline
              year={year}
              min={START_YEAR}
              max={endYear}
              playing={playing}
              speed={speed}
              polityCount={history.polities.length}
              events={typedEvents}
              loading={history.loading}
              onYearChange={changeYear}
              onTogglePlay={togglePlay}
              onSpeedChange={setSpeed}
            />
          )}
        </div>

        {isToday ? (
          <DetailsPanel
            country={country}
            region={region}
            subregion={subregion}
            regions={regionsState}
            subregions={subregions}
            subregionsState={subregionsState}
            onSelectRegion={selectRegion}
            onSelectSubregion={selectSubregion}
            onBack={goUpToday}
          />
        ) : place && placeState ? (
          <aside className="panel">
            <PlacePanel
              place={place}
              countryToday={countryToday}
              state={placeState}
              year={year}
              min={START_YEAR}
              max={endYear}
              onPickReign={pickReign}
              onClose={closePlace}
            />
          </aside>
        ) : (
          <HistoryPanel
            year={year}
            index={history.index}
            polities={history.polities}
            selectedName={polity?.name ?? null}
            error={history.error}
            onSelect={selectPolityOnly}
            onClear={clearPolity}
            onJumpTo={changeYear}
            eventsNow={pins.filter((e) => e.id !== selectedEvent?.id)}
            selectedEvent={selectedEvent}
            onSelectEvent={selectEvent}
            onClearEvent={clearEvent}
            onSpotHistory={lastClick ? () => pickPlace(lastClick) : null}
          />
        )}
      </main>
    </div>
  );
}
