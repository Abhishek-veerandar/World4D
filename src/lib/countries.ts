import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, MultiLineString } from 'geojson';
import worldData from 'world-atlas/countries-110m.json';

export type CountryProperties = { name: string };

export type CountryFeature = Feature<Geometry, CountryProperties> & { id: string };

type WorldTopology = Topology<{
  countries: GeometryCollection<CountryProperties>;
  land: GeometryCollection;
}>;

const world = worldData as unknown as WorldTopology;

const collection = feature(world, world.objects.countries) as FeatureCollection<
  Geometry,
  CountryProperties
>;

// A few disputed territories have no ISO id in world-atlas, so fall back to an index-based id.
export const countries: CountryFeature[] = collection.features.map((f, i) => ({
  ...f,
  id: f.id != null ? String(f.id) : `noid-${i}`,
}));

// Only shared borders (a !== b), so coastlines aren't drawn twice.
export const borders: MultiLineString = mesh(world, world.objects.countries, (a, b) => a !== b);
