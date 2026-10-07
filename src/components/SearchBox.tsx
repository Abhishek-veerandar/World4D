import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CountryFeature } from '../lib/countries';
import { colorFor, formatSpan, formatYear, loadHistoryIndex } from '../lib/history';
import { EVENT_TYPE_INFO, loadEvents, type HistoricalEvent } from '../lib/events';

type Result =
  | { kind: 'polity'; key: string; name: string; from: number; to: number; score: number }
  | { kind: 'event'; key: string; name: string; event: HistoricalEvent; score: number }
  | { kind: 'country'; key: string; name: string; country: CountryFeature; score: number };

type Props = {
  countries: CountryFeature[];
  onPickPolity: (name: string, from: number) => void;
  onPickEvent: (event: HistoricalEvent) => void;
  onPickCountry: (country: CountryFeature) => void;
};

const MAX_RESULTS = 10;
const KIND_ORDER = { polity: 0, country: 1, event: 2 } as const;

/** Lower-case and strip accents, so "Kyiv" finds "Kyïv" and "cordoba" finds "Córdoba". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** 0 exact, 1 starts with, 2 a word starts with, 3 contains anywhere; null = no match. */
function matchScore(name: string, query: string): number | null {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  const i = name.indexOf(query);
  if (i < 0) return null;
  return /[\s\-(']/.test(name[i - 1]) ? 2 : 3;
}

export default function SearchBox({ countries, onPickPolity, onPickEvent, onPickCountry }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [lifespans, setLifespans] = useState<Record<string, [number, number]>>({});
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Load the searchable data the first time the box is used (shared with the map).
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    loadHistoryIndex()
      .then((index) => setLifespans(index.lifespans))
      .catch(() => {});
    loadEvents()
      .then((file) => setEvents(file.events))
      .catch(() => {});
  }, [wanted]);

  // "/" focuses the search from anywhere, unless the user is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pre-normalized names, so each keystroke only does string comparisons.
  const polityIndex = useMemo(
    () => Object.entries(lifespans).map(([name, [from, to]]) => ({ name, n: normalize(name), from, to })),
    [lifespans],
  );
  const eventIndex = useMemo(() => events.map((e) => ({ e, n: normalize(e.name) })), [events]);
  const countryIndex = useMemo(
    () => countries.map((c) => ({ c, n: normalize(c.properties.name) })),
    [countries],
  );

  const results = useMemo<Result[]>(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    const found: Result[] = [];
    for (const p of polityIndex) {
      const score = matchScore(p.n, q);
      if (score !== null) found.push({ kind: 'polity', key: `p:${p.name}`, name: p.name, from: p.from, to: p.to, score });
    }
    for (const { c, n } of countryIndex) {
      const score = matchScore(n, q);
      if (score !== null) found.push({ kind: 'country', key: `c:${c.id}`, name: c.properties.name, country: c, score });
    }
    for (const { e, n } of eventIndex) {
      const score = matchScore(n, q);
      if (score !== null) found.push({ kind: 'event', key: `e:${e.id}`, name: e.name, event: e, score });
    }
    // Best match first; then empires before countries before events; then the
    // longest-lived empire or the most notable event.
    found.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (a.kind === 'polity' && b.kind === 'polity') return b.to - b.from - (a.to - a.from);
      if (a.kind === 'event' && b.kind === 'event') return b.event.score - a.event.score;
      return a.name.localeCompare(b.name);
    });
    return found.slice(0, MAX_RESULTS);
  }, [query, polityIndex, countryIndex, eventIndex]);

  useEffect(() => setActive(0), [results]);

  const pick = (r: Result) => {
    if (r.kind === 'polity') onPickPolity(r.name, r.from);
    else if (r.kind === 'event') onPickEvent(r.event);
    else onPickCountry(r.country);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else inputRef.current?.blur();
      setOpen(false);
    }
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div className="search">
      <input
        ref={inputRef}
        id="search-input"
        className="search-input"
        type="search"
        placeholder="Search empires, events, countries…"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setWanted(true);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search empires, events and countries"
      />
      <kbd className="search-hint" aria-hidden="true">
        /
      </kbd>

      {showList && (
        <ul className="search-results" id={listId} role="listbox">
          {results.length === 0 ? (
            <li className="search-empty">No matches</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                // mousedown keeps the input focused, so the click is not lost to blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <ResultRow result={r} />
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function ResultRow({ result }: { result: Result }) {
  if (result.kind === 'polity') {
    return (
      <>
        <span className="swatch" style={{ background: colorFor(result.name) }} aria-hidden="true" />
        <span className="result-name">{result.name}</span>
        <span className="result-meta">{formatSpan(result.from, result.to)}</span>
      </>
    );
  }
  if (result.kind === 'event') {
    const info = EVENT_TYPE_INFO[result.event.type];
    return (
      <>
        <span className="swatch round" style={{ background: info.color }} aria-hidden="true" />
        <span className="result-name">{result.name}</span>
        <span className="result-meta">
          {info.singular} · {formatYear(result.event.year)}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="swatch outline" aria-hidden="true" />
      <span className="result-name">{result.name}</span>
      <span className="result-meta">Country today</span>
    </>
  );
}
