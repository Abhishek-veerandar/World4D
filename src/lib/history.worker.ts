/**
 * Background worker: downloads and decodes history chunks off the main thread,
 * so the map keeps animating while the next century loads.
 */
import { fetchChunkFeatures } from './historyDecode';

export type WorkerRequest = { id: number; url: string; file: string; version: string };
export type WorkerResponse =
  | { id: number; features: Awaited<ReturnType<typeof fetchChunkFeatures>> }
  | { id: number; error: string };

const post = (message: WorkerResponse) =>
  (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, url, file, version } = event.data;
  try {
    post({ id, features: await fetchChunkFeatures(url, file, version) });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
