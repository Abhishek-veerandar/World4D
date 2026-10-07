import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  geoGraticule10,
  geoNaturalEarth1,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { FeatureCollection, MultiLineString } from 'geojson';
import type { CountryFeature } from '../lib/countries';
import type { RegionFeature } from '../lib/regions';
import { colorFor, formatYear, type PolityFeature } from '../lib/history';
import {
  EVENT_TYPE_INFO,
  eventFreshness,
  eventPinRadius,
  type HistoricalEvent,
} from '../lib/events';
import { useElementSize } from '../hooks/useElementSize';
import Breadcrumb, { type Crumb } from './Breadcrumb';

export type MapMode = 'history' | 'today';

type Props = {
  mode: MapMode;
  /** The shape the camera should frame, or null for the whole world. */
  focus: GeoPermissibleObjects | null;
  loadingLabel: string | null;
  crumbs: Crumb[];
  /** Ocean click, reset button: back to the whole world. */
  onReset: () => void;
  /** Esc key: up one level. */
  onBack: () => void;

  // ---- history mode ----
  land: FeatureCollection;
  polities: PolityFeature[];
  selectedPolityName: string | null;
  onSelectPolity: (polity: PolityFeature) => void;
  /** Events to pin on the map, and the year used to fade older ones. */
  events: HistoricalEvent[];
  year: number;
  selectedEventId: string | null;
  onSelectEvent: (event: HistoricalEvent) => void;

  // ---- today mode ----
  countries: CountryFeature[];
  borders: MultiLineString;
  /** States / provinces of the selected country (empty until loaded). */
  regions: RegionFeature[];
  /** Districts of the selected state (empty until loaded). */
  subregions: RegionFeature[];
  selectedCountryId: string | null;
  selectedRegionId: string | null;
  selectedSubregionId: string | null;
  onSelectCountry: (country: CountryFeature) => void;
  onSelectRegion: (region: RegionFeature) => void;
  onSelectSubregion: (region: RegionFeature) => void;

  /** Extra overlays drawn over the map (e.g. event filters). */
  children?: ReactNode;
};

type Tooltip = { name: string; x: number; y: number } | null;
type ShapeData = { id: string; name: string; d: string; fill?: string };

// Deep zoom is needed for districts: a small district is a few pixels wide at world scale.
const MAX_ZOOM = 1000;
const MAX_FOCUS_ZOOM = 600;
/** Zoom used when flying to a single point (an event). */
const POINT_FOCUS_ZOOM = 6;
const SPHERE = { type: 'Sphere' } as const;
const NO_SHAPES: ShapeData[] = [];

/**
 * The current pan/zoom, shared with layers that must not scale with the map
 * (event pins). Only those layers re-render while panning.
 */
function createTransformStore() {
  let current: ZoomTransform = zoomIdentity;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next: ZoomTransform) {
      current = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type TransformStore = ReturnType<typeof createTransformStore>;

export default function WorldMap(props: Props) {
  const {
    mode,
    focus,
    loadingLabel,
    crumbs,
    onReset,
    onBack,
    land,
    polities,
    selectedPolityName,
    onSelectPolity,
    events,
    year,
    selectedEventId,
    onSelectEvent,
    countries,
    borders,
    regions,
    subregions,
    selectedCountryId,
    selectedRegionId,
    selectedSubregionId,
    onSelectCountry,
    onSelectRegion,
    onSelectSubregion,
    children,
  } = props;

  const { ref: containerRef, width, height } = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const transformStore = useMemo(() => createTransformStore(), []);

  const isHistory = mode === 'history';

  // Projection and path generator, re-fitted whenever the container resizes.
  const path = useMemo(() => {
    const projection = geoNaturalEarth1().fitSize([width, height], SPHERE);
    return geoPath(projection);
  }, [width, height]);

  // Historical borders are already dense, so d3's adaptive resampling (for curved
  // great-circle edges) adds work without visible benefit. Turning it off and
  // rounding to 2 decimals makes these paths ~2-3x cheaper to build and draw.
  const historyProjection = useMemo(
    () => geoNaturalEarth1().fitSize([width, height], SPHERE).precision(0),
    [width, height],
  );
  const historyPath = useMemo(() => geoPath(historyProjection).digits(2), [historyProjection]);

  const spherePath = useMemo(() => path(SPHERE) ?? '', [path]);
  const graticulePath = useMemo(() => path(geoGraticule10()) ?? '', [path]);

  // ---------- history shapes ----------

  const landPath = useMemo(() => (isHistory ? (path(land) ?? '') : ''), [isHistory, path, land]);

  // Most polities keep the same record for many years, so cache each record's path
  // string: scrubbing the timeline then only computes paths for records that changed.
  const polityPathCache = useMemo(() => new WeakMap<PolityFeature, string>(), [historyPath]);
  const polityShapes = useMemo<ShapeData[]>(() => {
    if (!isHistory) return NO_SHAPES;
    return polities.map((p) => {
      let d = polityPathCache.get(p);
      if (d === undefined) {
        d = historyPath(p) ?? '';
        polityPathCache.set(p, d);
      }
      return { id: p.id, name: p.properties.name, d, fill: colorFor(p.properties.name) };
    });
  }, [isHistory, polities, historyPath, polityPathCache]);

  // ---------- today shapes ----------

  const countryShapes = useMemo<ShapeData[]>(
    () =>
      isHistory
        ? NO_SHAPES
        : countries.map((c) => ({ id: c.id, name: c.properties.name, d: path(c) ?? '' })),
    [isHistory, countries, path],
  );
  const regionShapes = useMemo<ShapeData[]>(
    () =>
      isHistory
        ? NO_SHAPES
        : regions.map((r) => ({ id: r.id, name: r.properties.shapeName, d: path(r) ?? '' })),
    [isHistory, regions, path],
  );
  const subregionShapes = useMemo<ShapeData[]>(
    () =>
      isHistory
        ? NO_SHAPES
        : subregions.map((r) => ({ id: r.id, name: r.properties.shapeName, d: path(r) ?? '' })),
    [isHistory, subregions, path],
  );
  const bordersPath = useMemo(
    () => (isHistory ? '' : (path(borders) ?? '')),
    [isHistory, path, borders],
  );

  // ---------- click handlers (shapes report a stable id) ----------

  const polityById = useMemo(() => new Map(polities.map((p) => [p.id, p])), [polities]);
  const countryById = useMemo(() => new Map(countries.map((c) => [c.id, c])), [countries]);
  const regionById = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const subregionById = useMemo(() => new Map(subregions.map((r) => [r.id, r])), [subregions]);

  const handlePolityClick = useCallback(
    (id: string) => {
      const p = polityById.get(id);
      if (p) onSelectPolity(p);
    },
    [polityById, onSelectPolity],
  );
  const handleCountryClick = useCallback(
    (id: string) => {
      const c = countryById.get(id);
      if (c) onSelectCountry(c);
    },
    [countryById, onSelectCountry],
  );
  const handleRegionClick = useCallback(
    (id: string) => {
      const r = regionById.get(id);
      if (r) onSelectRegion(r);
    },
    [regionById, onSelectRegion],
  );
  const handleSubregionClick = useCallback(
    (id: string) => {
      const r = subregionById.get(id);
      if (r) onSelectSubregion(r);
    },
    [subregionById, onSelectSubregion],
  );

  // ---------- pan & zoom ----------

  // The transform is written straight to the <g> element so that dragging
  // doesn't re-render hundreds of React elements on every frame.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !width || !height) return;

    const zoom = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .on('zoom', (event) => {
        gRef.current?.setAttribute('transform', event.transform.toString());
        transformStore.set(event.transform);
      });

    select(svg).call(zoom).on('dblclick.zoom', null);
    zoomRef.current = zoom;

    return () => {
      select(svg).on('.zoom', null);
    };
  }, [width, height, transformStore]);

  const animateTo = useCallback((transform: ZoomTransform) => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    zoom.transform(select(svg).transition().duration(750), transform);
  }, []);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    zoom.scaleBy(select(svg).transition().duration(300), factor);
  };

  // Fly to whatever is in focus, or back out to the full world.
  useEffect(() => {
    if (!width || !height || !zoomRef.current) return;
    if (!focus) {
      animateTo(zoomIdentity);
      return;
    }
    // A single point (an event) has no size to fit, so use a fixed zoom.
    const point = focus as { type?: string; coordinates?: unknown };
    if (point.type === 'Point' && Array.isArray(point.coordinates)) {
      const p = historyProjection(point.coordinates as [number, number]);
      if (p) {
        animateTo(
          zoomIdentity
            .translate(width / 2, height / 2)
            .scale(POINT_FOCUS_ZOOM)
            .translate(-p[0], -p[1]),
        );
      }
      return;
    }
    const [[x0, y0], [x1, y1]] = path.bounds(focus);
    const scale = Math.max(
      1,
      Math.min(MAX_FOCUS_ZOOM, 0.85 / Math.max((x1 - x0) / width, (y1 - y0) / height)),
    );
    animateTo(
      zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2),
    );
  }, [focus, path, historyProjection, width, height, animateTo]);

  // Escape goes up one level. Ignored while typing in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  // ---------- tooltip ----------

  const handleHover = useCallback(
    (name: string, e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({ name, x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [containerRef],
  );
  const handleLeave = useCallback(() => setTooltip(null), []);

  // A hovered shape can disappear when the year changes; drop its stale tooltip.
  useEffect(() => setTooltip(null), [mode]);

  // Once a deeper layer is drawn, the layer above it fades into the background.
  const showingRegions = regionShapes.length > 0;
  const showingSubregions = subregionShapes.length > 0;

  return (
    <div className="map" ref={containerRef}>
      {width > 0 && height > 0 && (
        <svg ref={svgRef} width={width} height={height} role="img" aria-label="World map">
          <g ref={gRef}>
            <path className="sphere" d={spherePath} onClick={onReset} />
            <path className="graticule" d={graticulePath} />

            {isHistory && (
              <>
                <path className="land-base" d={landPath} onClick={onReset} />
                <g className={selectedPolityName ? 'layer layer-polities focused' : 'layer layer-polities'}>
                  {polityShapes.map((s) => (
                    <Shape
                      key={s.id}
                      {...s}
                      className={s.name === selectedPolityName ? 'polity selected' : 'polity'}
                      onSelect={handlePolityClick}
                      onHover={handleHover}
                      onLeave={handleLeave}
                    />
                  ))}
                </g>
              </>
            )}

            {!isHistory && (
              <>
                <g
                  className={
                    selectedCountryId ? 'layer layer-countries focused' : 'layer layer-countries'
                  }
                >
                  {countryShapes.map((s) => (
                    <Shape
                      key={s.id}
                      {...s}
                      className={
                        s.id === selectedCountryId
                          ? showingRegions
                            ? 'country current'
                            : 'country selected'
                          : 'country'
                      }
                      onSelect={handleCountryClick}
                      onHover={handleHover}
                      onLeave={handleLeave}
                    />
                  ))}
                  <path className="borders" d={bordersPath} />
                </g>

                {showingRegions && (
                  <g
                    className={
                      selectedRegionId ? 'layer layer-regions focused' : 'layer layer-regions'
                    }
                  >
                    {regionShapes.map((s) => (
                      <Shape
                        key={s.id}
                        {...s}
                        className={
                          s.id === selectedRegionId
                            ? showingSubregions
                              ? 'region current'
                              : 'region selected'
                            : 'region'
                        }
                        onSelect={handleRegionClick}
                        onHover={handleHover}
                        onLeave={handleLeave}
                      />
                    ))}
                  </g>
                )}

                {showingSubregions && (
                  <g className="layer layer-subregions">
                    {subregionShapes.map((s) => (
                      <Shape
                        key={s.id}
                        {...s}
                        className={
                          s.id === selectedSubregionId ? 'subregion selected' : 'subregion'
                        }
                        onSelect={handleSubregionClick}
                        onHover={handleHover}
                        onLeave={handleLeave}
                      />
                    ))}
                  </g>
                )}
              </>
            )}
          </g>

          {isHistory && events.length > 0 && (
            <EventPins
              events={events}
              year={year}
              projection={historyProjection}
              store={transformStore}
              width={width}
              height={height}
              selectedId={selectedEventId}
              onSelect={onSelectEvent}
              onHover={handleHover}
              onLeave={handleLeave}
            />
          )}
        </svg>
      )}

      <Breadcrumb crumbs={crumbs} />

      {loadingLabel && (
        <div className="map-status" role="status">
          <span className="spinner" aria-hidden="true" />
          {loadingLabel}
        </div>
      )}

      {tooltip && (
        <div className="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.name}
        </div>
      )}

      <div className="zoom-controls">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={onReset} aria-label="Back to world view">
          ⟲
        </button>
      </div>

      {children}
    </div>
  );
}

type PinsProps = {
  events: HistoricalEvent[];
  year: number;
  projection: GeoProjection;
  store: TransformStore;
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (event: HistoricalEvent) => void;
  onHover: (name: string, e: MouseEvent) => void;
  onLeave: () => void;
};

/**
 * Event pins sit outside the zoomed group so they keep the same size at every
 * zoom level; their positions follow the map through the shared transform.
 */
const EventPins = memo(function EventPins({
  events,
  year,
  projection,
  store,
  width,
  height,
  selectedId,
  onSelect,
  onHover,
  onLeave,
}: PinsProps) {
  const transform = useSyncExternalStore(store.subscribe, store.get);
  const projected = useMemo(
    () =>
      events
        .map((event) => ({ event, point: projection([event.lon, event.lat]) }))
        // Draw the selected pin last so it sits on top.
        .sort((a, b) => Number(a.event.id === selectedId) - Number(b.event.id === selectedId)),
    [events, projection, selectedId],
  );

  return (
    <g className="event-pins">
      {projected.map(({ event, point }) => {
        if (!point) return null;
        const [x, y] = transform.apply(point);
        if (x < -20 || y < -20 || x > width + 20 || y > height + 20) return null;
        const selected = event.id === selectedId;
        const r = eventPinRadius(event) + (selected ? 2 : 0);
        const label = `${event.name} · ${formatYear(event.year)}`;
        return (
          <g
            key={event.id}
            className={selected ? 'event-pin selected' : 'event-pin'}
            transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
            style={{ opacity: selected ? 1 : eventFreshness(event, year) }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(event);
            }}
            onMouseMove={(e) => onHover(label, e)}
            onMouseLeave={onLeave}
            role="button"
            aria-label={`${EVENT_TYPE_INFO[event.type].singular}: ${label}`}
          >
            {selected && <circle className="event-pin-halo" r={r + 5} />}
            <circle r={r} fill={EVENT_TYPE_INFO[event.type].color} />
          </g>
        );
      })}
    </g>
  );
});

type ShapeProps = ShapeData & {
  className: string;
  onSelect: (id: string) => void;
  onHover: (name: string, e: MouseEvent) => void;
  onLeave: () => void;
};

const Shape = memo(function Shape({
  id,
  name,
  d,
  fill,
  className,
  onSelect,
  onHover,
  onLeave,
}: ShapeProps) {
  // Per-polity color goes through a CSS variable so hover/selected styles can still override it.
  const style = fill ? ({ '--fill': fill } as CSSProperties) : undefined;
  return (
    <path
      className={className}
      d={d}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
      onMouseMove={(e) => onHover(name, e)}
      onMouseLeave={onLeave}
    />
  );
});
