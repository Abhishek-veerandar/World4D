import { formatYear } from '../lib/history';
import type { HistoricalEvent } from '../lib/events';
import EventStrip from './EventStrip';

export const SPEEDS = [10, 20, 50, 100] as const;
export type Speed = (typeof SPEEDS)[number];

type Props = {
  year: number;
  min: number;
  max: number;
  playing: boolean;
  speed: Speed;
  polityCount: number;
  /** Events of the enabled types, drawn as a density strip above the slider. */
  events: HistoricalEvent[];
  loading: boolean;
  onYearChange: (year: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: Speed) => void;
};

const STEPS = [-100, -10, -1, 1, 10, 100];

export default function Timeline({
  year,
  min,
  max,
  playing,
  speed,
  polityCount,
  events,
  loading,
  onYearChange,
  onTogglePlay,
  onSpeedChange,
}: Props) {
  const clamp = (y: number) => Math.min(max, Math.max(min, y));

  return (
    <div className="timeline">
      <div className="timeline-top">
        <div className="timeline-year" aria-live="polite">
          <span className="year-value">{formatYear(year)}</span>
          <span className="year-meta">
            {loading ? 'Loading…' : `${polityCount} ${polityCount === 1 ? 'polity' : 'polities'}`}
          </span>
        </div>

        <div className="timeline-controls">
          {STEPS.slice(0, 3).map((step) => (
            <button
              key={step}
              type="button"
              className="step-btn"
              onClick={() => onYearChange(clamp(year + step))}
              disabled={year <= min}
              aria-label={`Back ${-step} years`}
            >
              {step}
            </button>
          ))}

          <button
            type="button"
            className="play-btn"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause' : 'Play through history'}
          >
            {playing ? '❚❚' : '▶'}
          </button>

          {STEPS.slice(3).map((step) => (
            <button
              key={step}
              type="button"
              className="step-btn"
              onClick={() => onYearChange(clamp(year + step))}
              disabled={year >= max}
              aria-label={`Forward ${step} years`}
            >
              +{step}
            </button>
          ))}

          <label className="speed">
            <span>Speed</span>
            <select
              value={speed}
              onChange={(e) => onSpeedChange(Number(e.target.value) as Speed)}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s} yrs/s
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {events.length > 0 && (
        <EventStrip
          events={events}
          min={min}
          max={max}
          year={year}
          onYearChange={onYearChange}
        />
      )}

      <input
        className="timeline-slider"
        type="range"
        min={min}
        max={max}
        step={1}
        value={year}
        onChange={(e) => onYearChange(Number(e.target.value))}
        aria-label="Year"
        aria-valuetext={formatYear(year)}
      />
      <div className="timeline-scale" aria-hidden="true">
        <span>{formatYear(min)}</span>
        <span>{formatYear(Math.round((min + max) / 2))}</span>
        <span>{formatYear(max)}</span>
      </div>
    </div>
  );
}
