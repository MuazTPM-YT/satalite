// Shared vertical thermal legend. One code path for 2D and 3D.
//
// Three things stack on one bar, and each answers a different question: the ramp
// says what a colour means, the DEF rule says where the limit sits inside that
// range, and the bracket says how much of the ramp THIS frame is actually using.
// Without the bracket a frame spanning three degrees looks identical to one
// spanning forty.
"use client";

import { useMemo } from "react";
import { buildLegendGradient } from "@/lib/thermalColormap";

interface ThermalLegendProps {
  // the fixed colour-scale bounds. undefined means no field was returned.
  min_c?: number;
  max_c?: number;
  // draw the DEF limit marker across the bar
  defLimit_c?: number;
  // the real spread in the frame on screen, shown so a reader can see how much of the
  // gradient is actually in use.
  frameMin_c?: number;
  frameMax_c?: number;
}

const BAR_H = 168;

export default function ThermalLegend({
  min_c,
  max_c,
  defLimit_c,
  frameMin_c,
  frameMax_c,
}: ThermalLegendProps) {
  const gradient = useMemo(() => buildLegendGradient(), []);

  if (min_c === undefined || max_c === undefined) {
    return (
      <div className="rounded-xl border border-hairline bg-bg-surface/85 px-2.5 py-2 backdrop-blur-xl">
        <span className="font-mono text-[10px] text-text-muted">no field</span>
      </div>
    );
  }

  const span = max_c - min_c;
  const frac = (c: number) => (span > 0 ? (max_c - c) / span : 0);
  const defFrac =
    defLimit_c !== undefined && defLimit_c >= min_c && defLimit_c <= max_c
      ? frac(defLimit_c)
      : null;

  // four evenly spaced graduations, top to bottom
  const ticks = [0, 1, 2, 3].map((i) => max_c - (span * i) / 3);

  const hasFrame = frameMin_c !== undefined && frameMax_c !== undefined;

  return (
    <div className="pointer-events-auto flex flex-col gap-2 rounded-xl border border-hairline bg-bg-surface/85 p-2.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <span className="text-center text-[9px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
        °C
      </span>

      <div className="flex items-stretch gap-1.5">
        <div
          className="relative w-3 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-inset ring-hairline"
          style={{ height: BAR_H, background: gradient }}
        >
          {defFrac !== null && (
            <div
              className="absolute inset-x-0 h-px bg-status-red"
              style={{ top: `${defFrac * 100}%` }}
            />
          )}
        </div>

        {/* the frame's own range, bracketed alongside the bar */}
        {hasFrame && (
          <div className="relative w-1 shrink-0" style={{ height: BAR_H }}>
            <div
              className="absolute inset-x-0 rounded-full bg-text-primary"
              style={{
                top: `${frac(frameMax_c!) * 100}%`,
                height: `${Math.max(2, (frac(frameMin_c!) - frac(frameMax_c!)) * 100)}%`,
              }}
            />
          </div>
        )}

        <div
          className="relative w-7 shrink-0 font-mono text-[9px] tabular-nums text-text-muted"
          style={{ height: BAR_H }}
        >
          {ticks.map((t, i) => (
            <span
              key={t}
              className="absolute left-0 -translate-y-1/2"
              style={{ top: `${(i / 3) * 100}%` }}
            >
              {t.toFixed(0)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-hairline pt-1.5">
        {defLimit_c !== undefined && (
          <span className="flex items-center gap-1 whitespace-nowrap font-mono text-[9px] tabular-nums text-status-red">
            <span className="h-px w-2.5 shrink-0 bg-status-red" />
            DEF {defLimit_c}
          </span>
        )}
        {hasFrame && (
          <span className="flex items-center gap-1 whitespace-nowrap font-mono text-[9px] tabular-nums text-text-muted">
            <span className="h-1.5 w-0.5 shrink-0 rounded-full bg-text-primary" />
            {frameMin_c!.toFixed(1)}–{frameMax_c!.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}
