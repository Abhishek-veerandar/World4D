import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, MultiLineString } from 'geojson';
import { numericToAlpha3 } from 'i18n-iso-countries';
import worldData from 'world-atlas/countries-110m.json';

export type CountryProperties = { name: string };

export type CountryFeature = Feature<Geometry, CountryProperties> & {
  id: string;
  /** ISO 3166-1 alpha-3 code (e.g. "IND"), used to load states and districts. */
  iso3: string | null;
};

type WorldTopology = Topology<{
  countries: GeometryCollection<CountryProperties>;
  land: GeometryCollection;
}>;

// Places without an ISO numeric code in world-atlas, matched by name instead.
const ISO3_BY_NAME: Record<string, string> = {
  Kosovo: 'XKX',
};

const world = worldData as unknown as WorldTopology;

const collection = feature(world, world.objects.countries) as FeatureCollection<
  Geometry,
  CountryProperties
>;

export const countries: CountryFeature[] = collection.features.map((f, i) => {
  const numeric = f.id != null ? String(f.id) : null;
  return {
    ...f,
    // A few disputed territories have no ISO id in world-atlas, so fall back to an index-based id.
    id: numeric ?? `noid-${i}`,
    iso3:
      (numeric ? numericToAlpha3(numeric) : undefined) ??
      ISO3_BY_NAME[f.properties.name] ??
      null,
  };
});

// Only shared borders (a !== b), so coastlines aren't drawn twice.
export const borders: MultiLineString = mesh(world, world.objects.countries, (a, b) => a !== b);

// All land as one shape: the neutral base drawn under historical borders.
export const land = feature(world, world.objects.land) as FeatureCollection;
