/**
 * Background worker: downloads and decodes history chunks off the main thread,
 * so the map keeps animating while the next century loads. It also answers
 * "who ruled this spot?" by scanning every century without blocking the page.
 */
import { fetchChunkFeatures, placeRecordsInChunk, type PlaceRecord } from './historyDecode';

export type ChunkRef = { url: string; file: string };

export type WorkerRequest =
  | { kind: 'chunk'; id: number; url: string; file: string; version: string }
  | { kind: 'place'; id: number; chunks: ChunkRef[]; version: string; lon: number; lat: number };

export type WorkerResponse =
  | { id: number; features: Awaited<ReturnType<typeof fetchChunkFeatures>> }
  | { id: number; progress: number; total: number }
  | { id: number; records: PlaceRecord[] }
  | { id: number; error: string };

const post = (message: WorkerResponse) =>
  (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const job = event.data;
  try {
    if (job.kind === 'chunk') {
      post({ id: job.id, features: await fetchChunkFeatures(job.url, job.file, job.version) });
      return;
    }
    const records: PlaceRecord[] = [];
    for (let i = 0; i < job.chunks.length; i++) {
      const { url, file } = job.chunks[i];
      records.push(...(await placeRecordsInChunk(url, file, job.version, job.lon, job.lat)));
      post({ id: job.id, progress: i + 1, total: job.chunks.length });
    }
    post({ id: job.id, records });
  } catch (err) {
    post({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
};
