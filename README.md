# World4D

An interactive world map built with React, TypeScript and D3.

## Features (step 1)

- World map (Natural Earth projection) drawn as SVG from `world-atlas` TopoJSON data
- Drag to pan, scroll or pinch to zoom, plus on-screen zoom buttons
- Country name tooltip on hover
- Click a country to fly to it and show its details (ISO code, approximate area, center point)
- Click the ocean, press `Esc` or hit reset to return to the full world view
- Responsive: the side panel moves below the map on small screens

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Scripts

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server with hot reload |
| `npm run build`   | Type-check and build to `dist/`      |
| `npm run preview` | Serve the production build locally   |

## Project structure

```
src/
  App.tsx                    # App layout and selected-country state
  main.tsx                   # React entry point
  index.css                  # Theme and layout styles
  components/
    WorldMap.tsx             # SVG map, pan/zoom, hover and click
    CountryPanel.tsx         # Details for the selected country
  hooks/
    useElementSize.ts        # Keeps the map sized to its container
  lib/
    countries.ts             # Loads TopoJSON and converts it to GeoJSON features
```
