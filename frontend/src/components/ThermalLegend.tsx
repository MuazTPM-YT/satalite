// shared vertical thermal legend — one code path for 2D + 3D views
"use client";

import { useMemo } from "react";
import { buildLegendGradient } from "@/lib/thermalColormap";

interface ThermalLegendProps {
  min_c?: number;
  max_c?: number;
  // draw red DEF limit marker across the bar when set
  defLimit_c?: number;
}

export default function ThermalLegend({
  min_c = 25,
  max_c = 75,
  defLimit_c,
}: ThermalLegendProps) {
  const gradient = useMemo(() => buildLegendGradient(), []);
  const defFrac =
    defLimit_c !== undefined
      ? (max_c - defLimit_c) / (max_c - min_c)
      : null;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-text-muted mb-1">°C</span>
      <div className="relative w-3 h-32 rounded-sm" style={{ background: gradient }}>
        {defFrac !== null && (
          <div
            className="absolute left-0 right-0 border-t-2 border-[#f85149]"
            style={{ top: `${defFrac * 100}%` }}
          />
        )}
      </div>
      <div className="flex flex-col items-end text-[9px] text-text-muted mt-1">
        <span>{max_c}</span>
        <span className="mt-5">{(min_c + max_c) / 2}</span>
        <span className="mt-5">{min_c}</span>
      </div>
      {defLimit_c !== undefined && (
        <span className="text-[9px] text-[#f85149] whitespace-nowrap mt-1">
          DEF {defLimit_c}°C
        </span>
      )}
    </div>
  );
}
