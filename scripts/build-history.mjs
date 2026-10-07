#!/usr/bin/env node
/**
 * Turns the Cliopatria dataset into small, time-chunked TopoJSON files the app
 * can load on demand.
 *
 *   1. Download cliopatria.geojson.zip from
 *      https://github.com/Seshat-Global-History-Databank/cliopatria and unzip it.
 *   2. npm run build:history -- path/to/cliopatria.geojson
 *
 * Output goes to public/history/: one TopoJSON file per century plus index.json.
 * TopoJSON stores each border line once, even when it is shared by neighbouring
 * polities or by the same polity across many years, which makes the files
 * roughly 3-4x smaller than plain GeoJSON.
 *
 * Cliopatria (Seshat Global History Databank) is licensed CC BY 4.0.
 * Changes made here: alliance/allegiance ("RELATION") rows and umbrella
 * entities removed, shapes simplified, coordinates rounded and quantized,
 * rings re-oriented for d3-geo.
 */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as topojsonServer from 'topojson-server';

// topojson-server ships as CommonJS; this works whichever way Node exposes it.
const topology = topojsonServer.topology ?? topojsonServer.default.topology;

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/build-history.mjs path/to/cliopatria.geojson');
  process.exit(1);
}

const OUT_DIR = resolve('public/history');
const TOLERANCE = Number(process.env.TOLERANCE ?? 0.03); // degrees (~3 km); higher = smaller files, coarser borders
const DECIMALS = 2; // ~1 km precision after rounding
const MIN_RING_POINTS = 4;
const CHUNK_YEARS = 100; // one file per century
const QUANTIZATION = 1e5; // TopoJSON grid size per chunk; 1e5 keeps sub-kilometre precision

console.log(`Reading ${input} …`);
const data = JSON.parse(readFileSync(input, 'utf8'));
// Names in parentheses, e.g. "(British Empire)", are umbrella entities whose shape is
// the union of member polities that are also in the data. Drawing both would stack
// shapes on top of each other, so only the members are kept; each member still
// records its umbrella in `memberOf`.
const isComposite = (p) => p.Name.startsWith('(') && p.Name.endsWith(')');
const features = data.features.filter(
  (f) => f.properties?.Type === 'POLITY' && f.geometry && !isComposite(f.properties),
);
console.log(`${features.length} polity records drawn (of ${data.features.length})`);

// ---------- geometry helpers ----------

const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;

function sqSegDist(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Iterative Douglas–Peucker. */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (maxSq > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Planar signed area; > 0 means counter-clockwise. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

function cleanRing(ring, isOuter) {
  const out = [];
  for (const p of simplify(ring, TOLERANCE)) {
    const q = [round(p[0]), round(p[1])];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) out.push(q);
  }
  if (out.length && (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])) out.push(out[0]);
  if (out.length < MIN_RING_POINTS) return null;
  // d3-geo wants outer rings clockwise and holes counter-clockwise.
  const ccw = signedArea(out) > 0;
  if (isOuter === ccw) out.reverse();
  return out;
}

function cleanPolygon(rings) {
  const outer = cleanRing(rings[0], true);
  if (!outer) return null;
  return [outer, ...rings.slice(1).map((r) => cleanRing(r, false)).filter(Boolean)];
}

function cleanGeometry(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const cleaned = polygons.map(cleanPolygon).filter(Boolean);
  if (!cleaned.length) return null;
  return cleaned.length === 1
    ? { type: 'Polygon', coordinates: cleaned[0] }
    : { type: 'MultiPolygon', coordinates: cleaned };
}

// ---------- build records ----------

/** Umbrella entities this polity belongs to, minus ones that just repeat its own name. */
function umbrellaOf(p) {
  if (!p.MemberOf) return undefined;
  const names = p.MemberOf.split(';')
    .map((n) => n.trim().replace(/^\(|\)$/g, ''))
    .filter((n) => n && n !== p.Name);
  return names.length ? names : undefined;
}

const records = [];
let dropped = 0;
for (const f of features) {
  const p = f.properties;
  const geometry = cleanGeometry(f.geometry);
  if (!geometry) {
    dropped++;
    continue;
  }
  records.push({
    name: p.Name,
    from: p.FromYear,
    to: p.ToYear,
    area: Math.round(p.Area ?? 0),
    wikipedia: p.Wikipedia || undefined,
    wikidata: p.Wikidata || undefined,
    memberOf: umbrellaOf(p),
    geometry,
  });
}
console.log(`${records.length} records kept, ${dropped} too small to draw`);

// ---------- write chunks ----------

const minYear = Math.min(...records.map((r) => r.from));
const maxYear = Math.max(...records.map((r) => r.to));
const firstChunk = Math.floor(minYear / CHUNK_YEARS) * CHUNK_YEARS;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const chunks = [];
const hash = createHash('sha256');
let totalBytes = 0;
let biggest = { file: '', bytes: 0 };

for (let start = firstChunk; start <= maxYear; start += CHUNK_YEARS) {
  const end = start + CHUNK_YEARS - 1;
  const inChunk = records.filter((r) => r.from <= end && r.to >= start);
  if (!inChunk.length) continue;

  const collection = {
    type: 'FeatureCollection',
    features: inChunk.map(({ geometry, ...properties }) => ({ type: 'Feature', properties, geometry })),
  };
  const json = JSON.stringify(topology({ polities: collection }, QUANTIZATION));

  const file = `${start < 0 ? `m${-start}` : start}.topo.json`;
  writeFileSync(join(OUT_DIR, file), json);
  hash.update(json);
  totalBytes += json.length;
  if (json.length > biggest.bytes) biggest = { file, bytes: json.length };
  chunks.push({ from: start, to: end, file, count: inChunk.length });
}

// Full lifespan of every polity, so the app can show it without loading every chunk.
const lifespans = {};
for (const r of records) {
  const span = lifespans[r.name];
  if (!span) lifespans[r.name] = [r.from, r.to];
  else {
    span[0] = Math.min(span[0], r.from);
    span[1] = Math.max(span[1], r.to);
  }
}

const index = {
  source: 'Cliopatria (Seshat Global History Databank), CC BY 4.0',
  sourceUrl: 'https://github.com/Seshat-Global-History-Databank/cliopatria',
  // Changes whenever the data changes; the app uses it to refresh its offline cache.
  version: hash.digest('hex').slice(0, 12),
  minYear,
  maxYear,
  chunks,
  lifespans,
};
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index));

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`Wrote ${chunks.length} chunks (${mb(totalBytes)} MB total) to ${OUT_DIR}`);
console.log(`Largest chunk: ${biggest.file} (${mb(biggest.bytes)} MB). Data version: ${index.version}`);
