import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { contains, rewind } from './regions';
import type { PolityFeature, PolityProperties } from './history';

/**
 * Downloading and decoding one history chunk. Kept free of React and the DOM so it
 * can run inside the background worker (history.worker.ts) or, as a fallback, on
 * the main thread.
 */

/** Cache names are versioned, so a data update never mixes old and new files. */
export const CACHE_PREFIX = 'world4d-history-';

export const MISSING_DATA_MESSAGE =
  'History data not found. Run "npm run build:history" first (see README).';

type ChunkTopology = Topology<{ polities: GeometryCollection<PolityProperties> }>;

export async function fetchChunkFeatures(
  url: string,
  file: string,
  version: string,
): Promise<PolityFeature[]> {
  const res = await cachedFetch(url, CACHE_PREFIX + version);
  if (!res.ok) {
    throw new Error(res.status === 404 ? MISSING_DATA_MESSAGE : `Could not load ${file} (${res.status})`);
  }
  const topo = await readJson<ChunkTopology>(res);
  const collection = feature(topo, topo.objects.polities) as FeatureCollection<
    Polygon | MultiPolygon,
    PolityProperties
  >;
  return collection.features.map((f, i) => ({
    ...f,
    id: `${file}:${i}`,
    // The build script already orients rings for d3; this only guards against a bad file.
    geometry: rewind(f.geometry),
  }));
}

/**
 * One polity record found at a point: its properties without the shape.
 * `near` marks records found just around the point rather than exactly on it.
 */
export type PlaceRecord = Omit<PolityProperties, 'bb'> & { near?: boolean };

/**
 * Points ~4 and ~10 km around the clicked spot. Simplified borders can cut away
 * narrow coasts (Istanbul's old city falls in such a gap), so these fill in
 * years when nothing contains the exact point.
 */
const NEAR_OFFSETS: [number, number][] = [0.04, 0.1].flatMap((r) =>
  [0, 45, 90, 135, 180, 225, 270, 315].map((deg): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }),
);
const NEAR_RADIUS = 0.1;

/** Area of a ring in square degrees (planar; only compared within one polity). */
function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(sum / 2);
}

/**
 * Whether a polity really holds the point. A hit inside a tiny detached piece of
 * a much larger polity is ignored: the source data has a few stray fragments
 * (e.g. a 5-point "Nazi Germany" sliver over Istanbul). Small city-states still
 * count, because there the small piece is the whole polity.
 */
function holds(geometry: Polygon | MultiPolygon, point: [number, number]): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let largest = 0;
  let hitArea = -1;
  for (const polygon of polygons) {
    const area = ringArea(polygon[0]);
    largest = Math.max(largest, area);
    if (hitArea < 0 && contains({ type: 'Polygon', coordinates: polygon }, point)) hitArea = area;
  }
  if (hitArea < 0) return false;
  return hitArea >= 0.05 || hitArea >= largest * 0.2;
}

/**
 * Every polity record in one chunk whose territory contains [lon, lat] (or, marked
 * `near`, the area just around it). Shapes are only decoded when their bounding
 * box is close to the point, so this stays cheap.
 */
export async function placeRecordsInChunk(
  url: string,
  file: string,
  version: string,
  lon: number,
  lat: number,
): Promise<PlaceRecord[]> {
  const res = await cachedFetch(url, CACHE_PREFIX + version);
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  const topo = await readJson<ChunkTopology>(res);
  const found: PlaceRecord[] = [];
  for (const geometry of topo.objects.polities.geometries) {
    const props = geometry.properties as PolityProperties | undefined;
    if (!props) continue;
    const bb = props.bb;
    if (
      bb &&
      (lon < bb[0] - NEAR_RADIUS ||
        lon > bb[2] + NEAR_RADIUS ||
        lat < bb[1] - NEAR_RADIUS ||
        lat > bb[3] + NEAR_RADIUS)
    ) {
      continue;
    }
    const shape = feature(topo, geometry) as Feature<Polygon | MultiPolygon, PolityProperties>;
    if (!shape.geometry) continue;
    const { bb: _unused, ...record } = props;
    void _unused; // only needed for the quick check above
    if (holds(shape.geometry, [lon, lat])) {
      found.push(record);
    } else if (NEAR_OFFSETS.some(([dx, dy]) => holds(shape.geometry, [lon + dx, lat + dy]))) {
      found.push({ ...record, near: true });
    }
  }
  return found;
}

/**
 * Serves from the browser's Cache Storage when possible, so each file is downloaded
 * once per data version. Falls back to a plain fetch where storage is unavailable
 * (private windows, non-HTTPS hosts other than localhost).
 */
async function cachedFetch(url: string, cacheName: string): Promise<Response> {
  let cache: Cache | null = null;
  try {
    if (typeof caches !== 'undefined') cache = await caches.open(cacheName);
  } catch {
    cache = null;
  }

  if (cache) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) return hit;
  }

  const res = await fetch(url);
  if (cache && res.ok) {
    // A full disk or blocked storage shouldn't break loading.
    await cache.put(url, res.clone()).catch(() => {});
  }
  return res;
}

/**
 * Parses JSON, treating anything else as missing data. Dev servers answer unknown
 * paths with the app's index.html (status 200), not a 404.
 */
export async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(MISSING_DATA_MESSAGE);
  }
}

/** Removes cached files from older data versions. */
export async function deleteOldCaches(currentVersion: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_PREFIX + currentVersion)
        .map((k) => caches.delete(k)),
    );
  } catch {
    // Storage blocked; nothing to clean up.
  }
}
