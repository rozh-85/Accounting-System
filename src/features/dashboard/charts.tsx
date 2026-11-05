import { clsx } from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatCompact = (value: number) => compact.format(value);

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth || fallback);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/** Rounds a maximum up to a tidy axis value split into `ticks` equal steps. */
function niceMax(max: number, ticks: number) {
  if (max <= 0) return ticks;
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  return step * ticks;
}

export interface SeriesDefinition {
  key: string;
  label: string;
  /** CSS color (a chart token). */
  color: string;
}

export interface LinePoint {
  label: string;
  /** Long label for the tooltip, e.g. "November 2026". */
  title: string;
  values: Record<string, number>;
}

/**
 * Multi-series line chart with a shared y-axis, crosshair tooltip and an
 * accessible data table. Always laid out left-to-right (time axis).
 */
export function LineChart({ series, points, height = 260, valueLabel }: { series: SeriesDefinition[]; points: LinePoint[]; height?: number; valueLabel?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 12, right: 14, bottom: 30, left: 52 };
  const plotW = Math.max(width - pad.left - pad.right, 40);
  const plotH = height - pad.top - pad.bottom;
  const ticks = 4;
  const max = niceMax(Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0))), ticks);
  const x = (i: number) => pad.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const labelEvery = plotW / Math.max(points.length, 1) < 46 ? 2 : 1;

  const onMove = (clientX: number, rect: DOMRect) => {
    if (points.length === 0) return;
    const local = clientX - rect.left - pad.left;
    const step = points.length === 1 ? plotW : plotW / (points.length - 1);
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(local / step))));
  };

  const active = hover === null ? null : points[hover];
  const tooltipLeft = hover === null ? 0 : x(hover);
  const flip = tooltipLeft > width - 190;

  return (
    <div dir="ltr">
      <div ref={ref} className="relative w-full" style={{ height }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={series.map((s) => s.label).join(', ')}
          className="block touch-none select-none"
          onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
        >
          {/* Grid and y-axis labels */}
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const value = (max / ticks) * i;
            const yy = y(value);
            return (
              <g key={i}>
                <line x1={pad.left} x2={pad.left + plotW} y1={yy} y2={yy} stroke="var(--color-line)" strokeDasharray={i === 0 ? undefined : '3 4'} />
                <text x={pad.left - 10} y={yy} dy="0.32em" textAnchor="end" className="fill-[var(--color-muted)] text-[11px]">
                  {formatCompact(value)}
                </text>
              </g>
            );
          })}

          {/* x-axis labels */}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text
                key={p.label + i}
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                className={clsx('text-[11px]', hover === i ? 'fill-[var(--color-ink)] font-semibold' : 'fill-[var(--color-muted)]')}
              >
                {p.label}
              </text>
            ) : null,
          )}

          {/* Crosshair */}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke="var(--color-line-strong)" strokeDasharray="4 4" />}

          {/* Series */}
          {series.map((s) => (
            <path
              key={s.key}
              d={points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.values[s.key] ?? 0).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* Markers: last point always, all series at the hovered point */}
          {series.map((s) => {
            const index = hover ?? points.length - 1;
            const p = points[index];
            if (!p) return null;
            return <circle key={s.key} cx={x(index)} cy={y(p.values[s.key] ?? 0)} r={hover === null ? 3.5 : 4.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />;
          })}
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[168px] rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px] shadow-[var(--shadow-pop)]"
            style={flip ? { right: width - tooltipLeft + 12 } : { left: tooltipLeft + 12 }}
          >
            <p className="mb-1.5 font-semibold text-ink">{active.title}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 py-0.5">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="num font-semibold text-ink">{full.format(active.values[s.key] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>{valueLabel}</caption>
        <thead>
          <tr>
            <th scope="col" />
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.title}>
              <th scope="row">{p.title}</th>
              {series.map((s) => (
                <td key={s.key}>{full.format(p.values[s.key] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-soft">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className="h-[3px] w-4 rounded-full" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Donut with a 2px surface gap between segments and a headline in the middle. */
export function DonutChart({
  segments,
  center,
  size = 196,
  thickness = 22,
}: {
  segments: Array<{ key: string; label: string; value: number; color: string }>;
  center: ReactNode;
  size?: number;
  thickness?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let offset = 0;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={segments.map((s) => `${s.label} ${full.format(s.value)}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-hover)" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s) => {
            const length = (Math.max(s.value, 0) / total) * circumference;
            const dash = Math.max(length - gap, 0);
            const element = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === s.key ? thickness + 4 : thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                className="cursor-pointer transition-[stroke-width]"
                onPointerEnter={() => setHover(s.key)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{`${s.label}: ${full.format(s.value)} (${Math.round((s.value / total) * 100)}%)`}</title>
              </circle>
            );
            offset += length;
            return element;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}
