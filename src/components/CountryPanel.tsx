import { useMemo } from 'react';
import { geoArea, geoCentroid } from 'd3-geo';
import type { CountryFeature } from '../lib/countries';

const EARTH_RADIUS_KM = 6371;

type Props = {
  country: CountryFeature | null;
  onClear: () => void;
};

function formatCoord(value: number, pos: string, neg: string) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? pos : neg}`;
}

export default function CountryPanel({ country, onClear }: Props) {
  const stats = useMemo(() => {
    if (!country) return null;
    const [lon, lat] = geoCentroid(country);
    // geoArea returns steradians; multiply by R² for km². Approximate at 1:110m.
    const area = geoArea(country) * EARTH_RADIUS_KM ** 2;
    return { lon, lat, area };
  }, [country]);

  if (!country || !stats) {
    return (
      <aside className="panel">
        <p className="panel-eyebrow">Explore</p>
        <h2>Pick a country</h2>
        <p className="panel-hint">
          Click any country to zoom in and see its details. Drag to pan, scroll or pinch to
          zoom, and press <kbd>Esc</kbd> to reset.
        </p>
      </aside>
    );
  }

  const isoCode = country.id.startsWith('noid-') ? '—' : country.id;

  return (
    <aside className="panel">
      <p className="panel-eyebrow">Selected country</p>
      <h2>{country.properties.name}</h2>
      <dl className="stats">
        <div>
          <dt>ISO numeric code</dt>
          <dd>{isoCode}</dd>
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
      <button type="button" className="clear-btn" onClick={onClear}>
        Back to world view
      </button>
    </aside>
  );
}
