import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { MultiLineString } from 'geojson';
import type { CountryFeature } from '../lib/countries';
import { useElementSize } from '../hooks/useElementSize';

type Props = {
  countries: CountryFeature[];
  borders: MultiLineString;
  selectedId: string | null;
  onSelect: (country: CountryFeature | null) => void;
};

type Tooltip = { name: string; x: number; y: number } | null;

const MAX_ZOOM = 12;
const SPHERE = { type: 'Sphere' } as const;

export default function WorldMap({ countries, borders, selectedId, onSelect }: Props) {
  const { ref: containerRef, width, height } = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip>(null);

  // Projection and path generator, re-fitted whenever the container resizes.
  const path = useMemo(() => {
    const projection = geoNaturalEarth1().fitSize([width, height], SPHERE);
    return geoPath(projection);
  }, [width, height]);

  // Pre-compute the SVG path strings once per size, not on every render.
  const shapes = useMemo(
    () => countries.map((c) => ({ country: c, d: path(c) ?? '' })),
    [countries, path],
  );
  const spherePath = useMemo(() => path(SPHERE) ?? '', [path]);
  const graticulePath = useMemo(() => path(geoGraticule10()) ?? '', [path]);
  const bordersPath = useMemo(() => path(borders) ?? '', [path, borders]);

  // Pan and zoom. The transform is written straight to the <g> element so that
  // dragging doesn't re-render ~180 React elements on every frame.
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
      });

    select(svg).call(zoom).on('dblclick.zoom', null);
    zoomRef.current = zoom;

    return () => {
      select(svg).on('.zoom', null);
    };
  }, [width, height]);

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

  // Fly to the selected country, or back out to the full world when cleared.
  useEffect(() => {
    if (!width || !height || !zoomRef.current) return;
    const country = countries.find((c) => c.id === selectedId);
    if (!country) {
      animateTo(zoomIdentity);
      return;
    }
    const [[x0, y0], [x1, y1]] = path.bounds(country);
    const scale = Math.max(
      1,
      Math.min(8, 0.85 / Math.max((x1 - x0) / width, (y1 - y0) / height)),
    );
    animateTo(
      zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2),
    );
  }, [selectedId, countries, path, width, height, animateTo]);

  // Escape clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  const handleHover = useCallback(
    (country: CountryFeature, e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        name: country.properties.name,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [containerRef],
  );

  const handleLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className="map" ref={containerRef}>
      {width > 0 && height > 0 && (
        <svg ref={svgRef} width={width} height={height} role="img" aria-label="World map">
          <g ref={gRef}>
            <path className="sphere" d={spherePath} onClick={() => onSelect(null)} />
            <path className="graticule" d={graticulePath} />
            {shapes.map(({ country, d }) => (
              <CountryShape
                key={country.id}
                country={country}
                d={d}
                selected={country.id === selectedId}
                onSelect={onSelect}
                onHover={handleHover}
                onLeave={handleLeave}
              />
            ))}
            <path className="borders" d={bordersPath} />
          </g>
        </svg>
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
        <button type="button" onClick={() => onSelect(null)} aria-label="Reset view">
          ⟲
        </button>
      </div>
    </div>
  );
}

type ShapeProps = {
  country: CountryFeature;
  d: string;
  selected: boolean;
  onSelect: (country: CountryFeature) => void;
  onHover: (country: CountryFeature, e: MouseEvent) => void;
  onLeave: () => void;
};

const CountryShape = memo(function CountryShape({
  country,
  d,
  selected,
  onSelect,
  onHover,
  onLeave,
}: ShapeProps) {
  return (
    <path
      className={selected ? 'country selected' : 'country'}
      d={d}
      onClick={() => onSelect(country)}
      onMouseMove={(e) => onHover(country, e)}
      onMouseLeave={onLeave}
    />
  );
});
