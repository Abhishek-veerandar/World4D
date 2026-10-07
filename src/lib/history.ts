import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { rewind } from './regions';

/**
 * Historical borders from Cliopatria (Seshat Global History Databank, CC BY 4.0),
 * pre-processed by scripts/build-history.mjs into public/history/.
 *
 * Each record holds one polity's borders for a span of years. A polity with
 * changing borders has many records, one per span.
 */
export type PolityProperties = {
  name: string;
  /** First and last year these borders apply to. Negative = BCE. */
  from: number;
  to: number;
  /** km², from the source data (equal-area projection). */
  area: number;
  wikipedia?: string;
  wikidata?: string;
  /** Umbrella entities this polity belonged to at the time, e.g. "British Empire". */
  memberOf?: string[];
};

export type PolityFeature = Feature<Polygon | MultiPolygon, PolityProperties> & { id: string };

type PolityRecord = PolityProperties & { geometry: Polygon | MultiPolygon };

export type HistoryChunk = { from: number; to: number; file: string; count: number };

export type HistoryIndex = {
  source: string;
  sourceUrl: string;
  minYear: number;
  maxYear: number;
  chunks: HistoryChunk[];
  /** Full lifespan of every polity: name → [first year, last year]. */
  lifespans: Record<string, [number, number]>;
};

const BASE = `${import.meta.env.BASE_URL}history/`;

let indexRequest: Promise<HistoryIndex> | null = null;
const chunkCache = new Map<string, Promise<PolityFeature[]>>();

export function loadHistoryIndex(): Promise<HistoryIndex> {
  if (!indexRequest) {
    indexRequest = fetchJson<HistoryIndex>(`${BASE}index.json`);
    indexRequest.catch(() => {
      indexRequest = null;
    });
  }
  return indexRequest;
}

export function chunkForYear(index: HistoryIndex, year: number): HistoryChunk | undefined {
  return index.chunks.find((c) => c.from <= year && year <= c.to);
}

/** Loads (and caches) every polity record in one chunk. */
export function loadChunk(chunk: HistoryChunk): Promise<PolityFeature[]> {
  let request = chunkCache.get(chunk.file);
  if (!request) {
    request = fetchJson<PolityRecord[]>(`${BASE}${chunk.file}`).then((records) =>
      records.map(({ geometry, ...properties }, i) => ({
        type: 'Feature' as const,
        id: `${chunk.file}:${i}`,
        properties,
        // The build script already orients rings for d3; this is a cheap safety net.
        geometry: rewind(geometry),
      })),
    );
    request.catch(() => chunkCache.delete(chunk.file));
    chunkCache.set(chunk.file, request);
  }
  return request;
}

export function politiesAt(features: PolityFeature[], year: number): PolityFeature[] {
  return features.filter((f) => f.properties.from <= year && year <= f.properties.to);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'History data not found. Run "npm run build:history" first (see README).'
        : `Could not load ${url} (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

// ---------- display helpers ----------

export function formatYear(year: number): string {
  return year < 0 ? `${-year} BCE` : `${year} CE`;
}

export function formatSpan(from: number, to: number): string {
  return from === to ? formatYear(from) : `${formatYear(from)} – ${formatYear(to)}`;
}

export function wikipediaUrl(phrase: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(phrase.replace(/ /g, '_'))}`;
}

/** A stable, distinct color per polity name, so an empire keeps its color through time. */
export function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const lightness = 38 + (Math.abs(hash >> 9) % 3) * 6; // 38%, 44% or 50%
  return `hsl(${hue} 42% ${lightness}%)`;
}
