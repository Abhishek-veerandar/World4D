import { geoArea, geoCentroid } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson';

/**
 * Sub-national boundaries come from geoBoundaries (https://www.geoboundaries.org),
 * an open (CC BY 4.0) dataset with one file per country and admin level.
 *   ADM1 = states / provinces, ADM2 = districts / counties.
 */
export type AdminLevel = 'ADM1' | 'ADM2';

export type RegionProperties = {
  shapeName: string;
  shapeISO?: string;
  shapeID?: string;
  shapeGroup?: string;
  shapeType?: string;
};

export type RegionFeature = Feature<Polygon | MultiPolygon, RegionProperties> & { id: string };

/** The country simply has no boundaries published at this level. */
export class RegionsUnavailableError extends Error {}

const API_BASE = 'https://www.geoboundaries.org/api/current/gbOpen';

const cache = new Map<string, Promise<RegionFeature[]>>();

/** Loads (and caches) the regions of one country at one admin level. */
export function loadRegions(iso3: string, level: AdminLevel): Promise<RegionFeature[]> {
  const key = `${iso3}/${level}`;
  let request = cache.get(key);
  if (!request) {
    request = fetchRegions(iso3, level);
    // Don't cache failures, so the user can retry later.
    request.catch(() => cache.delete(key));
    cache.set(key, request);
  }
  return request;
}

async function fetchRegions(iso3: string, level: AdminLevel): Promise<RegionFeature[]> {
  let metaRes: Response;
  try {
    metaRes = await fetch(`${API_BASE}/${iso3}/${level}/`);
  } catch (err) {
    // When a country has no boundaries at this level, the API's error response
    // has no CORS headers, so the browser reports it as a network failure.
    if (navigator.onLine) throw new RegionsUnavailableError();
    throw err;
  }
  if (metaRes.status === 404) throw new RegionsUnavailableError();
  if (!metaRes.ok) throw new Error(`Boundary lookup failed (${metaRes.status})`);

  let meta: { simplifiedGeometryGeoJSON?: string; gjDownloadURL?: string };
  try {
    meta = await metaRes.json();
  } catch {
    throw new RegionsUnavailableError();
  }

  const url = meta.simplifiedGeometryGeoJSON ?? meta.gjDownloadURL;
  if (!url) throw new RegionsUnavailableError();

  const res = await fetch(toBrowserUrl(url));
  if (!res.ok) throw new Error(`Boundary download failed (${res.status})`);
  const data = (await res.json()) as FeatureCollection<Geometry, RegionProperties>;

  return data.features
    .filter(
      (f): f is Feature<Polygon | MultiPolygon, RegionProperties> =>
        f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
    )
    .map((f, i) => ({
      ...f,
      id: f.properties.shapeID ?? `${iso3}-${level}-${i}`,
      geometry: rewind(f.geometry),
    }));
}

/**
 * The API links to github.com/.../raw/... which redirects without CORS headers,
 * so browsers block it. The same Git LFS file is served with CORS from
 * media.githubusercontent.com.
 */
function toBrowserUrl(url: string): string {
  return url.replace(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\//,
    'https://media.githubusercontent.com/media/$1/$2/',
  );
}

/**
 * GeoJSON (RFC 7946) winds outer rings counter-clockwise, but d3-geo expects the
 * opposite: it would read each shape as "the whole globe except this region".
 * If a polygon covers more than half the sphere, its rings are reversed.
 */
export function rewind(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const fix = (rings: Position[][]): Position[][] =>
    geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI
      ? rings.map((ring) => [...ring].reverse())
      : rings;

  return geometry.type === 'Polygon'
    ? { ...geometry, coordinates: fix(geometry.coordinates) }
    : { ...geometry, coordinates: geometry.coordinates.map(fix) };
}

// Center points are computed once per loaded file, then reused for every state.
const centroidCache = new WeakMap<RegionFeature[], Position[]>();

function centroidsOf(regions: RegionFeature[]): Position[] {
  let centroids = centroidCache.get(regions);
  if (!centroids) {
    centroids = regions.map((r) => geoCentroid(r));
    centroidCache.set(regions, centroids);
  }
  return centroids;
}

function polygonsOf(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

// Even-odd ray casting in plain lon/lat. Much faster than d3's spherical
// geoContains, and accurate enough for "which state is this district in".
function inRing([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Planar point-in-polygon test (holes respected), in lon/lat. */
export function contains(geometry: Polygon | MultiPolygon, point: Position): boolean {
  return polygonsOf(geometry).some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole)),
  );
}

function bboxOf(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [outer] of polygonsOf(geometry)) {
    for (const [x, y] of outer) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * geoBoundaries doesn't say which district belongs to which state, so keep the
 * children whose center point falls inside the parent. A bounding-box check
 * skips the expensive test for districts that are obviously elsewhere.
 */
export function regionsWithin(parent: RegionFeature, children: RegionFeature[]): RegionFeature[] {
  const centroids = centroidsOf(children);
  const [minX, minY, maxX, maxY] = bboxOf(parent.geometry);
  return children.filter((_, i) => {
    const [x, y] = centroids[i];
    return x >= minX && x <= maxX && y >= minY && y <= maxY && contains(parent.geometry, [x, y]);
  });
}
