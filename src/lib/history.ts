import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  deleteOldCaches,
  fetchChunkFeatures,
  MISSING_DATA_MESSAGE,
  placeRecordsInChunk,
  readJson,
  type PlaceRecord,
} from './historyDecode';
import type { ChunkRef, WorkerRequest, WorkerResponse } from './history.worker';

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
  /** Bounding box [west, south, east, north] in degrees. */
  bb?: [number, number, number, number];
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
    request = runJob<PolityFeature[]>({ kind: 'chunk', ...chunkRef(index, chunk), version: index.version });
    request.catch(() => chunkCache.delete(key));
    chunkCache.set(key, request);
  }
  return request;
}

export function politiesAt(features: PolityFeature[], year: number): PolityFeature[] {
  return features.filter((f) => f.properties.from <= year && year <= f.properties.to);
}

/** Absolute URL of a chunk; the version in the query keeps caches from serving a stale file. */
function chunkRef(index: HistoryIndex, chunk: HistoryChunk): ChunkRef {
  return {
    url: new URL(`${BASE}${chunk.file}?v=${index.version}`, window.location.href).href,
    file: chunk.file,
  };
}

// ---------- who ruled this spot ----------

/** A stretch of time during which one polity held a place. */
export type Reign = {
  name: string;
  from: number;
  to: number;
  wikipedia?: string;
  memberOf?: string[];
};

/**
 * Every polity that held [lon, lat] across all of history, oldest first.
 * Scans each century in the background; `onProgress` reports centuries done.
 */
export async function placeHistory(
  index: HistoryIndex,
  lon: number,
  lat: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Reign[]> {
  const records = await runJob<PlaceRecord[]>(
    {
      kind: 'place',
      chunks: index.chunks.map((c) => chunkRef(index, c)),
      version: index.version,
      lon,
      lat,
    },
    onProgress,
  );
  return mergeReigns(records);
}

/**
 * Records come in short spans (borders change often) and repeat across chunk
 * boundaries. Join back-to-back spans of the same polity into one reign.
 */
export function mergeReigns(records: PlaceRecord[]): Reign[] {
  // Records found just around the point only count for years when nothing holds
  // the exact point; otherwise they'd add neighbours whenever a border is close.
  const exact = records.filter((r) => !r.near);
  const usable = records.filter(
    (r) => !r.near || !exact.some((e) => e.from <= r.to && r.from <= e.to),
  );

  const seen = new Set<string>();
  const unique = usable.filter((r) => {
    const key = `${r.name}|${r.from}|${r.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => a.from - b.from || a.to - b.to);

  const open = new Map<string, Reign>();
  const reigns: Reign[] = [];
  for (const r of unique) {
    const current = open.get(r.name);
    if (current && r.from <= current.to + 1) {
      current.to = Math.max(current.to, r.to);
      if (r.memberOf) current.memberOf = r.memberOf;
      continue;
    }
    const reign: Reign = { name: r.name, from: r.from, to: r.to, wikipedia: r.wikipedia, memberOf: r.memberOf };
    open.set(r.name, reign);
    reigns.push(reign);
  }
  return reigns.sort((a, b) => a.from - b.from || b.to - a.to);
}

// ---------- background worker ----------

type Job =
  | Omit<Extract<WorkerRequest, { kind: 'chunk' }>, 'id'>
  | Omit<Extract<WorkerRequest, { kind: 'place' }>, 'id'>;

type Pending = {
  job: Job;
  resolve: (value: never) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

let worker: Worker | null | undefined; // undefined: not started yet; null: unavailable
let nextJobId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const job = pending.get(msg.id);
      if (!job) return;
      if ('progress' in msg) {
        job.onProgress?.(msg.progress, msg.total);
        return;
      }
      pending.delete(msg.id);
      if ('error' in msg) job.reject(new Error(msg.error));
      else if ('features' in msg) job.resolve(msg.features as never);
      else job.resolve(msg.records as never);
    };
    // If the worker can't start (old browser, blocked script), finish its jobs here instead.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      const jobs = [...pending.values()];
      pending.clear();
      for (const p of jobs) runOnMainThread(p.job, p.onProgress).then(p.resolve as (v: unknown) => void, p.reject);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Runs a job in the worker when possible, otherwise right here. */
function runJob<T>(job: Job, onProgress?: (done: number, total: number) => void): Promise<T> {
  const w = getWorker();
  if (!w) return runOnMainThread(job, onProgress) as Promise<T>;
  return new Promise<T>((resolve, reject) => {
    const id = nextJobId++;
    pending.set(id, { job, resolve: resolve as (value: never) => void, reject, onProgress });
    w.postMessage({ ...job, id } satisfies WorkerRequest);
  });
}

async function runOnMainThread(
  job: Job,
  onProgress?: (done: number, total: number) => void,
): Promise<PolityFeature[] | PlaceRecord[]> {
  if (job.kind === 'chunk') return fetchChunkFeatures(job.url, job.file, job.version);
  const records: PlaceRecord[] = [];
  for (let i = 0; i < job.chunks.length; i++) {
    const { url, file } = job.chunks[i];
    records.push(...(await placeRecordsInChunk(url, file, job.version, job.lon, job.lat)));
    onProgress?.(i + 1, job.chunks.length);
  }
  return records;
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
