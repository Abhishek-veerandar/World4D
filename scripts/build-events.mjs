#!/usr/bin/env node
/**
 * Downloads notable historical events from Wikidata and saves them as
 * public/events/events.json for the timeline.
 *
 *   npm run build:events
 *
 * Needs internet access to query.wikidata.org; takes a minute or two.
 * Wikidata content is CC0 (public domain).
 *
 * Event types: battles (incl. sieges), wars, treaties, political events
 * (revolutions, coups, declarations of independence), city foundings, and
 * cities becoming capitals. Only events with a date, a location, and articles in
 * several Wikipedia languages (a simple notability test) are kept.
 *
 * The query and parsing helpers are exported so they can be tested in a browser;
 * file writing only happens when this file is run with Node.
 */

export const ENDPOINT = 'https://query.wikidata.org/sparql';
export const MIN_YEAR = -3400;
export const MAX_YEAR = 2024;

const LABELS = `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }`;
const ENWIKI = `OPTIONAL { ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> . }`;
// The event's own coordinates, or those of its location.
const COORD = `{ ?e wdt:P625 ?c } UNION { ?e wdt:P276/wdt:P625 ?c }`;

/**
 * A query for "things of one class with a date and a place". One class per query:
 * combining several classes with subclass matching makes Wikidata time out.
 */
function classQuery(cls, { minLinks, dateProps, extraLocation = '' }) {
  return `SELECT ?e ?eLabel ?eDescription (MIN(?d) AS ?date) (MAX(?end) AS ?endDate)
       (SAMPLE(?c) AS ?coord) (SAMPLE(?article) AS ?wiki) (MAX(?sl) AS ?links) WHERE {
  ?e wdt:P31/wdt:P279* wd:${cls} ; wikibase:sitelinks ?sl .
  FILTER(?sl >= ${minLinks})
  ?e ${dateProps.map((p) => `wdt:${p}`).join('|')} ?d .
  OPTIONAL { ?e wdt:P582 ?end }
  { ${COORD} } ${extraLocation}
  ${ENWIKI}
  ${LABELS}
} GROUP BY ?e ?eLabel ?eDescription`;
}

const SIGNED_AT = 'UNION { ?e wdt:P1071/wdt:P625 ?c }'; // "location of creation", e.g. where a treaty was signed

/** Each type runs one or more queries; their rows are combined. */
export const EVENT_TYPES = [
  {
    type: 'battle', // battles, including sieges
    queries: [classQuery('Q178561', { minLinks: 8, dateProps: ['P585', 'P580'] })],
  },
  {
    type: 'war',
    queries: [classQuery('Q198', { minLinks: 10, dateProps: ['P580', 'P585'] })],
  },
  {
    type: 'treaty',
    queries: [classQuery('Q131569', { minLinks: 8, dateProps: ['P585', 'P571', 'P580'], extraLocation: SIGNED_AT })],
  },
  {
    type: 'political',
    // Revolutions, rebellions, coups d'état, declarations of independence, assassinations.
    queries: ['Q10931', 'Q124734', 'Q45382', 'Q1464916', 'Q3882219'].map((cls) =>
      classQuery(cls, { minLinks: 8, dateProps: ['P580', 'P585', 'P571'], extraLocation: SIGNED_AT }),
    ),
  },
  {
    type: 'founding',
    // Very notable cities and their founding (inception) date.
    queries: [`SELECT ?e ?eLabel ?eDescription (MIN(?d) AS ?date) (SAMPLE(?c) AS ?coord)
       (SAMPLE(?article) AS ?wiki) (MAX(?sl) AS ?links) WHERE {
  ?e wdt:P31 ?cls ; wdt:P571 ?d ; wdt:P625 ?c ; wikibase:sitelinks ?sl .
  VALUES ?cls { wd:Q515 wd:Q1549591 wd:Q5119 wd:Q200250 wd:Q1637706 }
  FILTER(?sl >= 60)
  ${ENWIKI}
  ${LABELS}
} GROUP BY ?e ?eLabel ?eDescription`],
  },
  {
    type: 'capital',
    // A city becoming the capital of a notable state, from "capital of" with a start date.
    queries: [`SELECT ?e ?eLabel ?state ?stateLabel ?date ?coord ?wiki ?links WHERE {
  ?e p:P1376 ?st ; wikibase:sitelinks ?links ; wdt:P625 ?coord .
  FILTER(?links >= 40)
  ?st ps:P1376 ?state ; pq:P580 ?date .
  ?state wikibase:sitelinks ?stateLinks .
  FILTER(?stateLinks >= 30)
  OPTIONAL { ?wiki schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> . }
  ${LABELS}
}`],
  },
];

// ---------- capitals filter ----------

// "Capital of" in Wikidata also covers counties, provinces, oblasts and the like.
// Only capitals of states that matter on a world map are kept.
const ADMIN_UNIT =
  /\b(Governorate|Oblast|County|Federal District|Municipality|Municipal|Province|Prefecture|Department|Voivodeship|Canton|Krai|Okrug|Raion|Subah|Division|District|Diocese|Archdiocese|Eparchy|Comarca|Commune|Borough|Arrondissement|Guberniya|Uyezd|Region|Kreis|Bezirk|Metropolitan|Area|Islands?|Council|Parish|Ward|Presidency|Colony|Territory)\b|\bLän\b/i;
const SOVEREIGN =
  /\b(Kingdom|Empire|Dynasty|Caliphate|Sultanate|Khanate|Khaganate|Duchy|Principality|Republic|Electorate|Commonwealth|Tsardom|Shogunate|Emirate|Confederation|Confederacy|Union|Federation|Realm|Margraviate|Landgraviate|Viceroyalty|Raj|Hegemony|Despotate|Imamate|Hetmanate|Dominion|Protectorate|Regency|State)\b/i;

const normalizeName = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u2010-\u2015]/g, '-') // en/em dashes vs hyphens differ between datasets
    .toLowerCase()
    .replace(/^(the|ancient) /, '');

/**
 * Builds the test for "is this a state whose capital belongs on a world map":
 * not an administrative unit, and either a polity drawn on the history map, a
 * present-day country (also "West Germany", "North Vietnam"...), or a name that
 * says it is a kingdom, empire, republic, etc.
 */
export function makeCapitalFilter(knownStateNames) {
  const known = new Set(knownStateNames.map(normalizeName));
  return (state) => {
    if (ADMIN_UNIT.test(state)) return false;
    const n = normalizeName(state);
    return known.has(n) || known.has(n.replace(/^(west|east|north|south) /, '')) || SOVEREIGN.test(state);
  };
}

// ---------- parsing ----------

/** "-0490-09-12T00:00:00Z" → -490 (negative = BCE, as Wikidata stores it). */
export function parseYear(value) {
  if (!value) return null;
  const m = /^([+-]?\d+)-/.exec(value);
  return m ? parseInt(m[1], 10) : null;
}

/** "Point(12.49 41.89)" → [12.49, 41.89] (lon, lat). Rejects other globes and bad values. */
export function parseCoord(value) {
  if (!value) return null;
  const m = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/.exec(value.trim());
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];
}

const qid = (uri) => uri?.split('/').pop();
const wikiTitle = (uri) => (uri ? decodeURIComponent(uri.split('/wiki/')[1] ?? '').replace(/_/g, ' ') : undefined);

/**
 * One SPARQL result row → an event, or null when it lacks a usable date or place.
 * `isWorldCapital` filters capital rows by their state's name.
 */
export function toEvent(row, type, { isWorldCapital = () => true } = {}) {
  const v = (k) => row[k]?.value;
  const id = qid(v('e'));
  const name = v('eLabel');
  const year = parseYear(v('date'));
  const coord = parseCoord(v('coord'));
  // Unlabelled items come back with their Q-id as the label.
  if (!id || !name || name === id || year === null || !coord) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  const wiki = wikiTitle(v('wiki'));
  // Wikipedia titles are usually more specific than Wikidata labels ("First Battle of
  // Panipat" vs "Battle of Panipat"); drop disambiguation like " (1758)".
  const displayName = wiki ? wiki.replace(/ \([^)]*\)$/, '') : name;

  const event = { id, type, name: displayName, year, lon: coord[0], lat: coord[1], links: Number(v('links') ?? 0) };
  const end = parseYear(v('endDate'));
  if (end !== null && end > year && end <= MAX_YEAR) event.end = end;
  const desc = v('eDescription');
  if (desc) event.desc = desc;
  if (wiki) event.wiki = wiki;
  if (type === 'capital') {
    const state = v('stateLabel');
    if (!state || state === qid(v('state')) || !isWorldCapital(state)) return null;
    event.id = `${id}-${qid(v('state'))}-${year}`; // a city can become a capital more than once
    event.desc = `Becomes capital of ${state}`;
  }
  return event;
}

/** Turns all rows into a de-duplicated, year-sorted list. Earlier types win on duplicates. */
export function buildEvents(rowsByType, options = {}) {
  const seen = new Set();
  const events = [];
  for (const { type } of EVENT_TYPES) {
    for (const row of rowsByType[type] ?? []) {
      const event = toEvent(row, type, options);
      if (!event || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }
  return events.sort((a, b) => a.year - b.year || b.links - a.links);
}

// ---------- querying ----------

export async function runQuery(query, { userAgent, attempts = 4 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
      },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    // Wikidata rate-limits (429) and sometimes times out (5xx); wait and retry.
    if (attempt >= attempts || (res.status !== 429 && res.status < 500)) {
      throw new Error(`Wikidata query failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const wait = Number(res.headers.get('retry-after')) * 1000 || attempt * 5000;
    await new Promise((r) => setTimeout(r, wait));
  }
}

// ---------- CLI ----------

async function main() {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { resolve, join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { createRequire } = await import('node:module');

  // Names of states that count for capitals: the polities on the history map
  // (public/history/index.json) and present-day countries.
  const require = createRequire(import.meta.url);
  const knownStates = Object.values(require('i18n-iso-countries/langs/en.json').countries).flat();
  try {
    const index = JSON.parse(readFileSync(resolve('public/history/index.json'), 'utf8'));
    knownStates.push(...Object.keys(index.lifespans));
  } catch {
    console.warn('public/history/index.json not found; capitals are matched on country names only.');
  }
  const isWorldCapital = makeCapitalFilter(knownStates);

  const userAgent = 'World4D/0.5 (https://github.com/Abhishek-veerandar/World4D) build-events script';
  const rowsByType = {};
  for (const { type, queries } of EVENT_TYPES) {
    process.stdout.write(`Fetching ${type} … `);
    const t0 = Date.now();
    rowsByType[type] = [];
    // One at a time, to stay within Wikidata's fair-use limits.
    for (const query of queries) rowsByType[type].push(...(await runQuery(query, { userAgent })));
    console.log(`${rowsByType[type].length} rows (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }

  const events = buildEvents(rowsByType, { isWorldCapital });
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

  const body = JSON.stringify(events);
  const outDir = resolve('public/events');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'events.json'), JSON.stringify({
    source: 'Wikidata (CC0)',
    sourceUrl: 'https://www.wikidata.org',
    generated: new Date().toISOString().slice(0, 10),
    version: createHash('sha256').update(body).digest('hex').slice(0, 12),
    counts,
    events,
  }));

  console.log(`\nSaved ${events.length} events to public/events/events.json`);
  console.log(Object.entries(counts).map(([t, n]) => `  ${t}: ${n}`).join('\n'));
}

// Run only when executed directly (works with both / and \ path separators).
const invokedAs = typeof process !== 'undefined' ? process.argv?.[1]?.replace(/\\/g, '/').split('/').pop() : undefined;
if (invokedAs && import.meta.url.endsWith(invokedAs)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
