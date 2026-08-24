// shared vertical thermal legend. One code path for 2D and 3D.
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

export default function ThermalLegend({
  min_c,
  max_c,
  defLimit_c,
  frameMin_c,
  frameMax_c,
}: ThermalLegendProps) {
  const gradient = useMemo(() => buildLegendGradient(), []);

  if (min_c === undefined || max_c === undefined) {
    return <span className="text-[9px] text-text-muted">no field</span>;
  }

  const span = max_c - min_c;
  const frac = (c: number) => (span > 0 ? (max_c - c) / span : 0);
  const mid_c = (min_c + max_c) / 2;
  const defFrac = defLimit_c !== undefined && defLimit_c >= min_c && defLimit_c <= max_c
    ? frac(defLimit_c)
    : null;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-text-muted mb-1">°C</span>
      <div className="flex items-start gap-1">
        <div className="relative w-3 h-40 rounded-sm" style={{ background: gradient }}>
          {defFrac !== null && (
            <div className="absolute left-0 right-0 border-t-2 border-[#f85149]" style={{ top: `${defFrac * 100}%` }} />
          )}
          {/* the frame's own range, bracketed on the bar */}
          {frameMin_c !== undefined && frameMax_c !== undefined && (
            <div
              className="absolute -right-1 w-1 bg-[#f0f6fc]"
              style={{ top: `${frac(frameMax_c) * 100}%`, height: `${Math.max(1, (frac(frameMin_c) - frac(frameMax_c)) * 100)}%` }}
            />
          )}
        </div>
        <div className="relative h-40 text-[9px] text-text-muted tabular-nums w-8">
          <span className="absolute left-0" style={{ top: 0, transform: "translateY(-50%)" }}>{max_c.toFixed(0)}</span>
          <span className="absolute left-0" style={{ top: "50%", transform: "translateY(-50%)" }}>{mid_c.toFixed(0)}</span>
          <span className="absolute left-0" style={{ top: "100%", transform: "translateY(-50%)" }}>{min_c.toFixed(0)}</span>
        </div>
      </div>
      {defLimit_c !== undefined && (
        <span className="text-[9px] text-[#f85149] whitespace-nowrap mt-1 tabular-nums">
          DEF {defLimit_c} °C
        </span>
      )}
      {frameMin_c !== undefined && frameMax_c !== undefined && (
        <span className="text-[9px] text-text-muted whitespace-nowrap mt-0.5 tabular-nums">
          frame {frameMin_c.toFixed(1)}–{frameMax_c.toFixed(1)}
        </span>
      )}
    </div>
  );
}
