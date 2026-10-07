# World4D

An interactive world map that shows how the world's borders changed from 2000 BCE to today, built with React, TypeScript and D3.

## Modes

- **History**: borders of every mapped state, empire and kingdom for any year from 2000 BCE to 2024 CE
- **Today**: present-day countries, with drill-down into states/provinces and districts

## Features

- **Timeline**: drag the slider, step by ±1/10/100 years, or press play (10–100 years per second)
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
  umbrella entities removed, shapes simplified, one file per century (per 25–50 years after 1000 CE).
  Borders are approximations, especially for ancient periods, and the data only covers polities, so early
  periods show few shapes.

- Countries: [Natural Earth](https://www.naturalearthdata.com) via [`world-atlas`](https://github.com/topojson/world-atlas), bundled with the app
- States and districts: [geoBoundaries](https://www.geoboundaries.org) (CC BY 4.0), loaded on demand per country.
  Files are a few MB each, so the first load of a country takes a second or two.
  A few countries have no state or district data; the panel says so.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Updating the history data

The processed files are already in `public/history/`. To rebuild them from a newer Cliopatria release:

1. Download `cliopatria.geojson.zip` from the [Cliopatria repo](https://github.com/Seshat-Global-History-Databank/cliopatria) and unzip it.
2. Run `npm run build:history -- path/to/cliopatria.geojson` (plain Node, no extra packages).

## Scripts

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server with hot reload |
| `npm run build`   | Type-check and build to `dist/`      |
| `npm run preview` | Serve the production build locally   |
| `npm run build:history -- <file>` | Rebuild `public/history/` from Cliopatria |

## Project structure

```
scripts/
  build-history.mjs          # Cliopatria → public/history/ chunks
public/
  history/                   # index.json + one JSON file per time chunk
src/
  App.tsx                    # Modes, timeline playback, selections
  main.tsx                   # React entry point
  index.css                  # Theme and layout styles
  components/
    WorldMap.tsx             # SVG map layers, pan/zoom, hover and click
    DetailsPanel.tsx         # Details + list of sub-regions for the selection
    Breadcrumb.tsx           # World › Country › State › District
    Timeline.tsx             # Year slider, step buttons, play / speed
    HistoryPanel.tsx         # Polities in the current year, polity details
  hooks/
    useElementSize.ts        # Keeps the map sized to its container
    useRegions.ts            # Loads states / districts for a country
    useHistory.ts            # Loads the time chunk for a year, prefetches the next
  lib/
    countries.ts             # World TopoJSON → GeoJSON, ISO alpha-3 codes
    regions.ts               # geoBoundaries loading, cache, winding fix, district → state matching
    history.ts               # History data loading, year formatting, polity colors
```
