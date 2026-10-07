import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  deleteOldCaches,
  fetchChunkFeatures,
  MISSING_DATA_MESSAGE,
  readJson,
} from './historyDecode';
import type { WorkerRequest, WorkerResponse } from './history.worker';

/**
 * Historical borders from Cliopatria (Seshat Global History Databank, CC BY 4.0),
 * pre-processed by scripts/build-history.mjs into public/history/: one TopoJSON
 * file per century plus index.json.
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

export type HistoryChunk = { from: number; to: number; file: string; count: number };

export type HistoryIndex = {
  source: string;
  sourceUrl: string;
  /** Changes whenever the data is rebuilt; versions the browser cache. */
  version: string;
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
    // Always revalidated, so a rebuilt dataset is picked up on the next visit.
    indexRequest = fetch(`${BASE}index.json`, { cache: 'no-cache' }).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? MISSING_DATA_MESSAGE : `Could not load the history index (${res.status})`);
      const index = await readJson<HistoryIndex>(res);
      if (!index.version) throw new Error(MISSING_DATA_MESSAGE);
      void deleteOldCaches(index.version);
      return index;
    });
    indexRequest.catch(() => {
      indexRequest = null;
    });
  }
  return indexRequest;
}

export function chunkForYear(index: HistoryIndex, year: number): HistoryChunk | undefined {
  return index.chunks.find((c) => c.from <= year && year <= c.to);
}

/** Loads (and caches in memory) every polity record in one chunk. */
export function loadChunk(index: HistoryIndex, chunk: HistoryChunk): Promise<PolityFeature[]> {
  const key = `${index.version}/${chunk.file}`;
  let request = chunkCache.get(key);
  if (!request) {
    // The version in the URL keeps browsers and CDNs from serving a stale file.
    const url = new URL(`${BASE}${chunk.file}?v=${index.version}`, window.location.href).href;
    request = decodeInBackground({ url, file: chunk.file, version: index.version });
    request.catch(() => chunkCache.delete(key));
    chunkCache.set(key, request);
  }
  return request;
}

export function politiesAt(features: PolityFeature[], year: number): PolityFeature[] {
  return features.filter((f) => f.properties.from <= year && year <= f.properties.to);
}

// ---------- background worker ----------

type Job = Omit<WorkerRequest, 'id'>;
type Pending = Job & { resolve: (f: PolityFeature[]) => void; reject: (e: Error) => void };

let worker: Worker | null | undefined; // undefined: not started yet; null: unavailable
let nextJobId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if ('error' in event.data) job.reject(new Error(event.data.error));
      else job.resolve(event.data.features);
    };
    // If the worker can't start (old browser, blocked script), finish its jobs here instead.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) {
        fetchChunkFeatures(job.url, job.file, job.version).then(job.resolve, job.reject);
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

function decodeInBackground(job: Job): Promise<PolityFeature[]> {
  const w = getWorker();
  if (!w) return fetchChunkFeatures(job.url, job.file, job.version);
  return new Promise((resolve, reject) => {
    const id = nextJobId++;
    pending.set(id, { ...job, resolve, reject });
    w.postMessage({ id, ...job } satisfies WorkerRequest);
  });
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
