import { useCallback, useEffect, useMemo, useState } from 'react';
import WorldMap, { type MapMode } from './components/WorldMap';
import DetailsPanel from './components/DetailsPanel';
import HistoryPanel from './components/HistoryPanel';
import Timeline, { type Speed } from './components/Timeline';
import type { Crumb } from './components/Breadcrumb';
import { borders, countries, land, type CountryFeature } from './lib/countries';
import { regionsWithin, type RegionFeature } from './lib/regions';
import type { PolityFeature } from './lib/history';
import { useRegions } from './hooks/useRegions';
import { useHistory } from './hooks/useHistory';

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

export default function App() {
  const [mode, setMode] = useState<MapMode>('history');

  // ---------- history mode ----------

  const [year, setYear] = useState(DEFAULT_YEAR);
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

  // ---------- today mode ----------

  const [selection, setSelection] = useState<TodaySelection>(WORLD);
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

  const focus = isToday ? (subregion ?? region ?? country) : (polity?.focus ?? null);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          World<span>4D</span>
        </h1>
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
            onReset={isToday ? () => setSelection(WORLD) : clearPolity}
            onBack={isToday ? goUpToday : clearPolity}
            land={land}
            polities={history.polities}
            selectedPolityName={polity?.name ?? null}
            onSelectPolity={selectPolity}
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
          />
          {!isToday && (
            <Timeline
              year={year}
              min={START_YEAR}
              max={endYear}
              playing={playing}
              speed={speed}
              polityCount={history.polities.length}
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
        ) : (
          <HistoryPanel
            year={year}
            index={history.index}
            polities={history.polities}
            selectedName={polity?.name ?? null}
            error={history.error}
            onSelect={selectPolity}
            onClear={clearPolity}
            onJumpTo={changeYear}
          />
        )}
      </main>
    </div>
  );
}
