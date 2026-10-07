import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { rewind } from './regions';
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
