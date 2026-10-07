import { useCallback, useEffect, useState } from 'react';
import {
  loadRegions,
  RegionsUnavailableError,
  type AdminLevel,
  type RegionFeature,
} from '../lib/regions';

export type RegionsStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export type RegionsState = {
  status: RegionsStatus;
  regions: RegionFeature[];
  message?: string;
  retry: () => void;
};

type Loaded = { key: string; status: RegionsStatus; regions: RegionFeature[]; message?: string };

const EMPTY: RegionFeature[] = [];

/** Loads one admin level for a country. Pass `null` to load nothing. */
export function useRegions(iso3: string | null, level: AdminLevel): RegionsState {
  const key = iso3 ? `${iso3}/${level}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!iso3 || !key) return;
    let cancelled = false;

    loadRegions(iso3, level)
      .then((regions) => {
        if (cancelled) return;
        setLoaded({ key, status: regions.length ? 'ready' : 'unavailable', regions });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof RegionsUnavailableError) {
          setLoaded({ key, status: 'unavailable', regions: EMPTY });
        } else {
          setLoaded({
            key,
            status: 'error',
            regions: EMPTY,
            message: err instanceof Error ? err.message : 'Could not load boundaries',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [iso3, key, level, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, []);

  if (!key) return { status: 'idle', regions: EMPTY, retry };
  // Results for a different country (or a cleared retry) mean the new one is still loading.
  if (!loaded || loaded.key !== key) return { status: 'loading', regions: EMPTY, retry };
  return { status: loaded.status, regions: loaded.regions, message: loaded.message, retry };
}
