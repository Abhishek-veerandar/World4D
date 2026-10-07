import { useEffect, useMemo, useRef } from 'react';
import type { HistoricalEvent } from '../lib/events';
import { useElementSize } from '../hooks/useElementSize';

type Props = {
  events: HistoricalEvent[];
  min: number;
  max: number;
  year: number;
  onYearChange: (year: number) => void;
};

const HEIGHT = 22;

/**
 * A thin histogram above the year slider: how many events happened at each point
 * in time. Busy periods stand out at a glance; clicking jumps to that year.
 */
export default function EventStrip({ events, min, max, year, onYearChange }: Props) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Count events per pixel column.
  const bins = useMemo(() => {
    if (!width) return null;
    const counts = new Float32Array(width);
    const span = max - min;
    for (const e of events) {
      if (e.year < min || e.year > max) continue;
      counts[Math.min(width - 1, Math.floor(((e.year - min) / span) * width))]++;
    }
    let peak = 0;
    for (const c of counts) peak = Math.max(peak, c);
    return { counts, peak };
  }, [events, min, max, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bins || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const styles = getComputedStyle(canvas);
    ctx.fillStyle = styles.getPropertyValue('--strip-bar').trim() || '#6b7a9c';
    // Square-root scale so a few busy years don't flatten everything else.
    const scale = bins.peak ? (HEIGHT - 2) / Math.sqrt(bins.peak) : 0;
    for (let x = 0; x < width; x++) {
      const c = bins.counts[x];
      if (!c) continue;
      const h = Math.max(1.5, Math.sqrt(c) * scale);
      ctx.fillRect(x, HEIGHT - h, 1, h);
    }

    // Current year marker.
    const cx = ((year - min) / (max - min)) * width;
    ctx.fillStyle = styles.getPropertyValue('--strip-cursor').trim() || '#4fd1c5';
    ctx.fillRect(Math.round(cx) - 1, 0, 2, HEIGHT);
  }, [bins, width, year, min, max]);

  const jump = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onYearChange(Math.round(min + t * (max - min)));
  };

  return (
    <div
      ref={ref}
      className="event-strip"
      onClick={(e) => jump(e.clientX)}
      title="Number of events over time. Click to jump to a year."
      aria-hidden="true"
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: HEIGHT }} />
    </div>
  );
}
