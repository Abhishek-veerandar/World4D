# World4D

An interactive world map that shows how the world's borders changed from 2000 BCE to today, built with React, TypeScript and D3.

## Modes

- **History**: borders of every mapped state, empire and kingdom for any year from 2000 BCE to 2024 CE,
  with historical events pinned on the map
- **Today**: present-day countries, with drill-down into states/provinces and districts

## Features

- **Timeline**: drag the slider, step by ±1/10/100 years, or press play (10–100 years per second)
- **Search** (press `/`): empires, events and present-day countries; picking one jumps to it
- **Events**: battles, wars, treaties, political events (revolutions, coups, independence, assassinations),
  city foundings and new capitals, pinned where they happened while the timeline passes their year.
  Filter by type; a strip above the slider shows how busy each period is (click it to jump)
- Click a polity to follow it through time: its lifespan, area, umbrella entity (e.g. British Empire) and a Wikipedia link
- Each polity keeps the same color through time
- World map (Natural Earth projection) drawn as SVG from `world-atlas` TopoJSON data
- Drag to pan, scroll or pinch to zoom, plus on-screen zoom buttons
- Name tooltip on hover at every level
- **Drill down: World → Country → State / province → District**
  - Click a country to fly to it and load its states or provinces
  - Click a state to load its districts
  - Or pick any state / district from the searchable list in the side panel
- Details for the current selection: code, approximate area, center point
- Breadcrumb at the top of the map; `Esc` goes up one level, clicking the ocean returns to the world
- Boundary files are cached after the first load
- Responsive: the side panel moves below the map on small screens

## Data

- Historical borders: [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria)
  (Seshat Global History Databank), CC BY 4.0. Pre-processed into `public/history/`: alliance records and
  umbrella entities removed, shapes simplified, one TopoJSON file per century (about 10 MB in total).
  Borders are approximations, especially for ancient periods, and the data only covers polities, so early
  periods show few shapes.

- Events: [Wikidata](https://www.wikidata.org) (CC0), via `scripts/build-events.mjs` into `public/events/events.json`
  (about 7,600 events). Only events with a date, a place and articles in several Wikipedia languages are kept;
  capitals are limited to states on the history map or present-day countries. Some locations are approximate.

## Performance

- **TopoJSON**: each border line is stored once, even when neighbouring polities or many years of the same
  polity share it. The history data is about 10 MB instead of 42 MB as plain GeoJSON.
- **Background loading**: centuries are downloaded and decoded in a Web Worker (`src/lib/history.worker.ts`),
  so playback keeps running while the next century loads. The centuries on either side are prefetched.
- **Offline cache**: downloaded centuries are stored in the browser's Cache Storage, keyed by the data version
  in `index.json`. Repeat visits load nothing from the network; rebuilding the data replaces the cache.
- **Lighter drawing**: history shapes are projected without d3's adaptive resampling and rounded to 2 decimals.

## Updating the history data

The processed files are already in `public/history/`. To rebuild them from a newer Cliopatria release:

1. Download `cliopatria.geojson.zip` from the [Cliopatria repo](https://github.com/Seshat-Global-History-Databank/cliopatria) and unzip it.
2. Run `npm install` (once, for `topojson-server`), then `npm run build:history -- path/to/cliopatria.geojson`.

## Updating the event data

`public/events/events.json` is included. To refresh it from Wikidata (takes a minute or two):

```bash
npm run build:events
```

## Scripts

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server with hot reload |
| `npm run build`   | Type-check and build to `dist/`      |
| `npm run preview` | Serve the production build locally   |
| `npm run build:history -- <file>` | Rebuild `public/history/` from Cliopatria |
| `npm run build:events` | Refresh `public/events/events.json` from Wikidata |

## Project structure

```
scripts/
  build-history.mjs          # Cliopatria → public/history/ chunks
  build-events.mjs           # Wikidata → public/events/events.json
public/
  history/                   # index.json + one TopoJSON file per century
  events/                    # events.json
src/
  App.tsx                    # Modes, timeline playback, selections
  main.tsx                   # React entry point
  index.css                  # Theme and layout styles
  components/
    WorldMap.tsx             # SVG map layers, pan/zoom, hover and click
    DetailsPanel.tsx         # Details + list of sub-regions for the selection
    Breadcrumb.tsx           # World › Country › State › District
    Timeline.tsx             # Year slider, step buttons, play / speed
    HistoryPanel.tsx         # Polities and events in the current year, details
    SearchBox.tsx            # Search across empires, events and countries
    EventFilters.tsx         # Event type toggles over the map
    EventStrip.tsx           # Event density strip above the timeline slider
  hooks/
    useElementSize.ts        # Keeps the map sized to its container
    useRegions.ts            # Loads states / districts for a country
    useHistory.ts            # Loads the time chunk for a year, prefetches the next
    useEvents.ts             # Loads the event list once
  lib/
    countries.ts             # World TopoJSON → GeoJSON, ISO alpha-3 codes
    regions.ts               # geoBoundaries loading, cache, winding fix, district → state matching
    history.ts               # History index, chunk loading via the worker, year formatting, colors
    history.worker.ts        # Web Worker: download + decode a century off the main thread
    historyDecode.ts         # TopoJSON decoding and the versioned browser cache
    events.ts                # Event types, colors, which pins show in a year
```
