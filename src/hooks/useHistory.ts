import { useEffect, useMemo, useState } from 'react';
import {
  chunkForYear,
  loadChunk,
  loadHistoryIndex,
  politiesAt,
  type HistoryIndex,
  type PolityFeature,
} from '../lib/history';

export type HistoryState = {
  index: HistoryIndex | null;
  /** Polities on the map in the given year. */
  polities: PolityFeature[];
  /** True while the chunk for this year is still downloading. */
  loading: boolean;
  error: string | null;
};

type Loaded = { file: string; features: PolityFeature[] };

/** Loads the century of history around `year`. Pass enabled=false to pause loading. */
export function useHistory(year: number, enabled: boolean): HistoryState {
  const [index, setIndex] = useState<HistoryIndex | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || index) return;
    let cancelled = false;
    loadHistoryIndex()
      .then((i) => !cancelled && setIndex(i))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [enabled, index]);

  const chunk = index ? chunkForYear(index, year) : undefined;

  useEffect(() => {
    if (!enabled || !index || !chunk) return;
    let cancelled = false;
    loadChunk(index, chunk)
      .then((features) => {
        if (cancelled) return;
        setLoaded({ file: chunk.file, features });
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [enabled, index, chunk]);

  // Once this century is in, fetch the ones on either side in the background, so
  // playback and scrubbing never wait at a century boundary.
  const currentReady = loaded?.file === chunk?.file;
  useEffect(() => {
    if (!enabled || !index || !chunk || !currentReady) return;
    const i = index.chunks.indexOf(chunk);
    for (const neighbour of [index.chunks[i + 1], index.chunks[i - 1]]) {
      if (neighbour) loadChunk(index, neighbour).catch(() => {});
    }
  }, [enabled, index, chunk, currentReady]);

  // While a new chunk downloads, keep drawing the previous one so the map doesn't blank out.
  const polities = useMemo(
    () => (loaded ? politiesAt(loaded.features, year) : []),
    [loaded, year],
  );

  return {
    index,
    polities,
    loading: enabled && !error && (!index || (!!chunk && loaded?.file !== chunk.file)),
    error,
  };
}
