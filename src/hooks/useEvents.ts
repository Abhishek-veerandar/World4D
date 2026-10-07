import { useEffect, useState } from 'react';
import { loadEvents, type HistoricalEvent } from '../lib/events';

export type EventsState = {
  events: HistoricalEvent[];
  loading: boolean;
  error: string | null;
};

const NONE: HistoricalEvent[] = [];

/** Loads every event once `enabled` is first true, then keeps them. */
export function useEvents(enabled: boolean): EventsState {
  const [events, setEvents] = useState<HistoricalEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || events) return;
    let cancelled = false;
    loadEvents()
      .then((file) => {
        if (cancelled) return;
        setEvents(file.events);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [enabled, events]);

  return { events: events ?? NONE, loading: enabled && !events && !error, error };
}
