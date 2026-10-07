import { useMemo, useState } from 'react';
import { geoArea, geoCentroid, type GeoPermissibleObjects } from 'd3-geo';
import type { CountryFeature } from '../lib/countries';
import type { RegionFeature } from '../lib/regions';
import type { RegionsState } from '../hooks/useRegions';

const EARTH_RADIUS_KM = 6371;

type Props = {
  country: CountryFeature | null;
  region: RegionFeature | null;
  subregion: RegionFeature | null;
  /** States / provinces of the selected country. */
  regions: RegionsState;
  /** Districts inside the selected state, plus the load state of the country's district file. */
  subregions: RegionFeature[];
  subregionsState: RegionsState;
  onSelectRegion: (region: RegionFeature) => void;
  onSelectSubregion: (region: RegionFeature) => void;
  onBack: () => void;
};

function formatCoord(value: number, pos: string, neg: string) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? pos : neg}`;
}

function useStats(feature: GeoPermissibleObjects | null) {
  return useMemo(() => {
    if (!feature) return null;
    const [lon, lat] = geoCentroid(feature);
    // geoArea returns steradians; multiply by R² for km². Approximate (simplified shapes).
    const area = geoArea(feature) * EARTH_RADIUS_KM ** 2;
    return { lon, lat, area };
  }, [feature]);
}

export default function DetailsPanel({
  country,
  region,
  subregion,
  regions,
  subregions,
  subregionsState,
  onSelectRegion,
  onSelectSubregion,
  onBack,
}: Props) {
  const current = subregion ?? region ?? country;
  const stats = useStats(current);

  if (!country || !current || !stats) {
    return (
      <aside className="panel">
        <p className="panel-eyebrow">Explore</p>
        <h2>Pick a country</h2>
        <p className="panel-hint">
          Click any country to zoom in and see its states or provinces. Click a state to see its
          districts. Drag to pan, scroll or pinch to zoom, and press <kbd>Esc</kbd> to go back up
          a level.
        </p>
      </aside>
    );
  }

  let eyebrow: string;
  let name: string;
  let code: string;
  if (subregion) {
    eyebrow = 'District';
    name = subregion.properties.shapeName;
    code = subregion.properties.shapeISO || '—';
  } else if (region) {
    eyebrow = 'State / province';
    name = region.properties.shapeName;
    code = region.properties.shapeISO || '—';
  } else {
    eyebrow = 'Country';
    name = country.properties.name;
    code = country.iso3 ?? (country.id.startsWith('noid-') ? '—' : country.id);
  }

  const backLabel = subregion
    ? `Back to ${region?.properties.shapeName ?? 'state'}`
    : region
      ? `Back to ${country.properties.name}`
      : 'Back to world view';

  return (
    <aside className="panel">
      <p className="panel-eyebrow">{eyebrow}</p>
      <h2>{name}</h2>

      <dl className="stats">
        <div>
          <dt>Code</dt>
          <dd>{code}</dd>
        </div>
        <div>
          <dt>Approx. area</dt>
          <dd>{Math.round(stats.area).toLocaleString()} km²</dd>
        </div>
        <div>
          <dt>Center point</dt>
          <dd>
            {formatCoord(stats.lat, 'N', 'S')}, {formatCoord(stats.lon, 'E', 'W')}
          </dd>
        </div>
      </dl>

      {!region && (
        <RegionList
          key={country.id}
          title="States & provinces"
          state={regions}
          items={regions.regions}
          emptyText="No state or province boundaries are published for this country."
          onSelect={onSelectRegion}
        />
      )}

      {region && !subregion && (
        <RegionList
          key={region.id}
          title="Districts"
          state={subregionsState}
          items={subregions}
          emptyText="No district boundaries are available for this area."
          onSelect={onSelectSubregion}
        />
      )}

      <button type="button" className="clear-btn" onClick={onBack}>
        {backLabel}
      </button>

      <p className="attribution">
        Boundaries:{' '}
        <a href="https://www.geoboundaries.org" target="_blank" rel="noreferrer">
          geoBoundaries
        </a>{' '}
        (CC BY 4.0) · Natural Earth
      </p>
    </aside>
  );
}

type ListProps = {
  title: string;
  state: RegionsState;
  items: RegionFeature[];
  emptyText: string;
  onSelect: (region: RegionFeature) => void;
};

function RegionList({ title, state, items, emptyText, onSelect }: ListProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...items].sort((a, b) =>
      a.properties.shapeName.localeCompare(b.properties.shapeName),
    );
    return q ? sorted.filter((r) => r.properties.shapeName.toLowerCase().includes(q)) : sorted;
  }, [items, query]);

  return (
    <section className="region-list">
      <h3>
        {title}
        {state.status === 'ready' && items.length > 0 && <span className="count">{items.length}</span>}
      </h3>

      {state.status === 'loading' && <p className="muted">Loading boundaries…</p>}

      {state.status === 'error' && (
        <p className="muted">
          Couldn&apos;t load boundaries ({state.message}).{' '}
          <button type="button" className="link-btn" onClick={state.retry}>
            Try again
          </button>
        </p>
      )}

      {(state.status === 'idle' ||
        state.status === 'unavailable' ||
        (state.status === 'ready' && items.length === 0)) && (
        <p className="muted">{emptyText}</p>
      )}

      {state.status === 'ready' && items.length > 0 && (
        <>
          {items.length > 10 && (
            <input
              className="list-filter"
              type="search"
              placeholder={`Filter ${title.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <ul>
            {visible.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onSelect(r)}>
                  {r.properties.shapeName}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="muted">No matches.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
