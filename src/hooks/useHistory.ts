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

/** Loads the century (or decades) of history around `year`. Pass enabled=false to pause loading. */
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
    if (!enabled || !chunk) return;
    let cancelled = false;
    loadChunk(chunk)
      .then((features) => {
        if (cancelled) return;
        setLoaded({ file: chunk.file, features });
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [enabled, chunk]);

  // Fetch the next chunk ahead of time once we're in the last quarter of this one,
  // so playback doesn't stall at chunk boundaries.
  useEffect(() => {
    if (!enabled || !index || !chunk) return;
    const progress = (year - chunk.from) / (chunk.to - chunk.from + 1);
    if (progress < 0.75) return;
    const next = index.chunks[index.chunks.indexOf(chunk) + 1];
    if (next) loadChunk(next).catch(() => {});
  }, [enabled, index, chunk, year]);

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
