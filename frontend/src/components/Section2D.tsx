// 2D section view. contour-band cross-section, dimension lines, legend, history chart
"use client";

import { useMemo } from "react";
import type { ThermalSimulationResult } from "@/lib/mockThermalField";
import { tempToColor } from "@/lib/thermalColormap";
import ThermalLegend from "@/components/ThermalLegend";

// same temp scale as 3D viewer so colours line up across views
const TEMP_MIN_C = 25;
const TEMP_MAX_C = 75;
// discrete contour band width — 2D stepped on purpose, 3D stays smooth
const BAND_STEP_C = 5;

// svg drawing scale
const SCALE = 700; // px per metre
const MARGIN = { left: 96, top: 64, right: 24, bottom: 56 };

interface Section2DProps {
  sim: ThermalSimulationResult;
  timeIndex: number;
  // element length from shared LeftPanel config state
  length_m: number;
}

// clamp temp into contour band index
function bandIndex(temp_c: number): number {
  const clamped = Math.max(TEMP_MIN_C, Math.min(TEMP_MAX_C - 1e-6, temp_c));
  return Math.floor((clamped - TEMP_MIN_C) / BAND_STEP_C);
}

// band colour from shared colormap, sampled at band centre
function bandColor(band: number): string {
  const mid_c = TEMP_MIN_C + (band + 0.5) * BAND_STEP_C;
  const [r, g, b] = tempToColor(mid_c, TEMP_MIN_C, TEMP_MAX_C);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

// horizontal dimension line with end ticks and label
function DimH({
  x1,
  x2,
  y,
  label,
}: {
  x1: number;
  x2: number;
  y: number;
  label: string;
}) {
  return (
    <g stroke="currentColor" className="text-text-secondary" strokeWidth="1">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} />
      <line x1={x2} y1={y - 5} x2={x2} y2={y + 5} />
      <text
        x={(x1 + x2) / 2}
        y={y - 7}
        textAnchor="middle"
        fontSize="11"
        stroke="none"
        fill="currentColor"
        className="tabular-nums"
      >
        {label}
      </text>
    </g>
  );
}

// vertical dimension line with end ticks and label
function DimV({
  y1,
  y2,
  x,
  label,
}: {
  y1: number;
  y2: number;
  x: number;
  label: string;
}) {
  return (
    <g stroke="currentColor" className="text-text-secondary" strokeWidth="1">
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - 5} y1={y1} x2={x + 5} y2={y1} />
      <line x1={x - 5} y1={y2} x2={x + 5} y2={y2} />
      <text
        x={x - 8}
        y={(y1 + y2) / 2}
        textAnchor="middle"
        fontSize="11"
        stroke="none"
        fill="currentColor"
        className="tabular-nums"
        transform={`rotate(-90 ${x - 8} ${(y1 + y2) / 2})`}
      >
        {label}
      </text>
    </g>
  );
}

// thermal history chart — core/surface temp + strength pct, now marker + DEF line
function HistoryChart({
  sim,
  timeIndex,
}: {
  sim: ThermalSimulationResult;
  timeIndex: number;
}) {
  const W = 920;
  const H = 190;
  const ml = 44;
  const mr = 58;
  const mt = 12;
  const mb = 24;
  const T_MIN = 20;
  const T_MAX = 80;
  const max_h = sim.times_h[sim.times_h.length - 1] ?? 72;
  const def_limit = sim.flags.def_risk.limit;
  const strength_req_pct = Math.round(sim.flags.strip_ready.required_strength_pct * 100);

  // plot position helpers
  const x = (h: number) => ml + (h / max_h) * (W - ml - mr);
  const tempY = (t: number) => mt + ((T_MAX - t) / (T_MAX - T_MIN)) * (H - mt - mb);
  const strY = (p: number) => mt + (1 - p) * (H - mt - mb);

  // polyline path for a series
  const path = (vals: number[], y: (v: number) => number) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(sim.times_h[i]).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const corePath = path(sim.curves.core_temp_c, tempY);
  const surfPath = path(sim.curves.surface_temp_c, tempY);
  const strPath = path(sim.curves.strength_frac.map((s) => s * 100), strY);
  const now_h = sim.times_h[timeIndex] ?? 0;

  return (
    <div className="border-t border-border-default bg-bg-surface px-4 py-2">
      <div className="flex items-center gap-4 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
          Thermal history
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-text-secondary">
          <span className="w-3 h-0.5 bg-[#f0883e] rounded" /> Core °C
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-text-secondary">
          <span className="w-3 h-0.5 bg-[#58a6ff] rounded" /> Surface °C
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-text-secondary">
          <span className="w-3 h-0.5 bg-[#3fb950] rounded" /> Strength % f&apos;c
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 170 }} role="img" aria-label="Thermal history chart">
        {/* left axis line + temp ticks */}
        <line x1={ml} y1={mt} x2={ml} y2={H - mb} stroke="rgba(240,246,252,0.25)" />
        {[20, 40, 60, 80].map((t) => (
          <g key={t}>
            <line x1={ml} y1={tempY(t)} x2={W - mr} y2={tempY(t)} stroke="rgba(240,246,252,0.08)" />
            <line x1={ml - 4} y1={tempY(t)} x2={ml} y2={tempY(t)} stroke="rgba(240,246,252,0.3)" />
            <text x={ml - 6} y={tempY(t) + 3} textAnchor="end" fontSize="9" fill="rgba(240,246,252,0.45)">
              {t}
            </text>
          </g>
        ))}
        {/* right axis line + strength pct ticks, 70% = strip-ready req */}
        <line x1={W - mr} y1={mt} x2={W - mr} y2={H - mb} stroke="rgba(63,185,80,0.4)" />
        {[0, 25, 50, strength_req_pct, 100].map((p) => (
          <g key={p}>
            <line x1={W - mr} y1={strY(p)} x2={W - mr + 4} y2={strY(p)} stroke="rgba(63,185,80,0.4)" />
            <text
              x={W - mr + 7}
              y={strY(p) + 3}
              fontSize="9"
              fill="#3fb950"
              opacity={p === strength_req_pct ? 1 : 0.7}
              fontWeight={p === strength_req_pct ? 600 : 400}
            >
              {p}%
            </text>
          </g>
        ))}
        {/* strip-ready strength req reference across plot */}
        <line x1={ml} y1={strY(strength_req_pct)} x2={W - mr} y2={strY(strength_req_pct)} stroke="rgba(63,185,80,0.3)" strokeDasharray="4 4" />
        {/* bottom axis line + x ticks */}
        <line x1={ml} y1={H - mb} x2={W - mr} y2={H - mb} stroke="rgba(240,246,252,0.25)" />
        {[0, 12, 24, 36, 48, 60, 72].map((h) => (
          <g key={h}>
            <line x1={x(h)} y1={H - mb} x2={x(h)} y2={H - mb + 4} stroke="rgba(240,246,252,0.3)" />
            <text x={x(h)} y={H - mb + 15} textAnchor="middle" fontSize="9" fill="rgba(240,246,252,0.45)">
              {h}h
            </text>
          </g>
        ))}
        {/* DEF limit reference */}
        <line x1={ml} y1={tempY(def_limit)} x2={W - mr} y2={tempY(def_limit)} stroke="#f85149" strokeWidth="1" strokeDasharray="6 4" />
        <text x={W - mr - 4} y={tempY(def_limit) - 4} textAnchor="end" fontSize="9" fill="#f85149">
          DEF limit {def_limit}°C
        </text>
        {/* series */}
        <path d={strPath} fill="none" stroke="#3fb950" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={surfPath} fill="none" stroke="#58a6ff" strokeWidth="1.5" />
        <path d={corePath} fill="none" stroke="#f0883e" strokeWidth="2" />
        {/* now marker synced with scrubber */}
        <line x1={x(now_h)} y1={mt} x2={x(now_h)} y2={H - mb} stroke="rgba(240,246,252,0.6)" strokeWidth="1" strokeDasharray="4 4" />
        <circle cx={x(now_h)} cy={tempY(sim.curves.core_temp_c[timeIndex] ?? 0)} r="3" fill="#f0883e" />
        <circle cx={x(now_h)} cy={tempY(sim.curves.surface_temp_c[timeIndex] ?? 0)} r="3" fill="#58a6ff" />
      </svg>
    </div>
  );
}

export default function Section2D({ sim, timeIndex, length_m }: Section2DProps) {
  const { grid, fields } = sim;
  const current_h = sim.times_h[timeIndex] ?? 0;

  // dims derived from outline — same source of truth as 3D mesh, no second copy
  const dims = useMemo(() => {
    const pts = grid.outline;
    const xs = pts.map((p) => p[0]);
    const ys = [...new Set(pts.map((p) => p[1]))].sort((a, b) => a - b);
    const flangeWidth = Math.max(...xs);
    const totalDepth = Math.max(...pts.map((p) => p[1]));
    const webBottom = pts.filter((p) => p[1] === 0);
    const webWidth = webBottom[1][0] - webBottom[0][0];
    const flangeDepth = totalDepth - ys[1];
    return { flangeWidth, totalDepth, webWidth, flangeDepth, webLeft: webBottom[0][0] };
  }, [grid]);

  // contour-band geometry: one path per band + boundary lines between bands
  const drawing = useMemo(() => {
    const { nx, ny, dx_m, mask } = grid;
    const slice = fields.temperature_c[timeIndex] ?? fields.temperature_c[0];
    const cell = dx_m * SCALE;

    const bandPaths = new Map<number, string>();
    const bounds: string[] = [];

    // grid coords to svg px (flip y so flange sits on top)
    const px = (i: number) => MARGIN.left + i * cell;
    const py = (j: number) => MARGIN.top + (ny - 1 - j) * cell;

    const bands: number[][] = [];
    for (let j = 0; j < ny; j++) {
      const row: number[] = [];
      for (let i = 0; i < nx; i++) {
        row.push(mask[j][i] === 1 ? bandIndex(slice[j][i]) : -1);
      }
      bands.push(row);
    }

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const b = bands[j][i];
        if (b < 0) continue;
        // cell rect appended to its band path
        const rect = `M${px(i).toFixed(1)} ${py(j).toFixed(1)}h${cell.toFixed(1)}v${cell.toFixed(1)}h-${cell.toFixed(1)}Z`;
        bandPaths.set(b, (bandPaths.get(b) ?? "") + rect);
        // boundary where neighbour cell sits in a different band
        if (i + 1 < nx && bands[j][i + 1] >= 0 && bands[j][i + 1] !== b) {
          bounds.push(`M${px(i + 1).toFixed(1)} ${py(j).toFixed(1)}v${cell.toFixed(1)}`);
        }
        if (j + 1 < ny && bands[j + 1][i] >= 0 && bands[j + 1][i] !== b) {
          bounds.push(`M${px(i).toFixed(1)} ${py(j + 1).toFixed(1)}h${cell.toFixed(1)}`);
        }
      }
    }

    const outlinePts = grid.outline
      .map(([x_m, y_m]) => `${(MARGIN.left + x_m * SCALE).toFixed(1)},${(MARGIN.top + (dims.totalDepth - y_m) * SCALE).toFixed(1)}`)
      .join(" ");

    return { bandPaths: [...bandPaths.entries()], boundsPath: bounds.join(""), outlinePts };
  }, [grid, fields, timeIndex, dims.totalDepth]);

  // pixel geometry for shape box
  const shapeW = dims.flangeWidth * SCALE;
  const shapeH = dims.totalDepth * SCALE;
  const svgW = MARGIN.left + shapeW + MARGIN.right;
  const svgH = MARGIN.top + shapeH + MARGIN.bottom;
  const shapeTop = MARGIN.top;
  const shapeBottom = MARGIN.top + shapeH;
  const webMidX = MARGIN.left + (dims.webLeft + dims.webWidth / 2) * SCALE;
  const flangeBottomY = MARGIN.top + (dims.totalDepth - (dims.totalDepth - dims.flangeDepth)) * SCALE;
  const def_limit = sim.flags.def_risk.limit;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* header row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <div className="px-3 py-1 text-xs rounded-md bg-bg-primary border border-border-default text-text-primary font-medium">
          Section A-A
        </div>
        <span className="text-xs text-text-secondary">
          mid-span (z = {Math.round((length_m / 2) * 1000)} mm) ·{" "}
          <span className="font-semibold text-text-primary">{current_h.toFixed(1)} h</span>
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-text-muted">
          Contour bands {BAND_STEP_C}°C · scale {TEMP_MIN_C}–{TEMP_MAX_C}°C
        </span>
      </div>

      {/* drawing + legend */}
      <div className="flex-1 flex min-h-0 bg-bg-primary">
        <div className="flex-1 flex items-center justify-center min-w-0 p-2">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
            role="img"
            aria-label="T-beam cross-section temperature contours"
          >
            {/* band fills */}
            {drawing.bandPaths.map(([band, d]) => (
              <path key={band} d={d} fill={bandColor(band)} />
            ))}
            {/* band boundary lines */}
            <path d={drawing.boundsPath} stroke="rgba(0,0,0,0.35)" strokeWidth="1" fill="none" />
            {/* outline on top */}
            <polygon points={drawing.outlinePts} fill="none" stroke="rgba(240,246,252,0.8)" strokeWidth="1.5" />

            {/* extension lines for dimensions */}
            <g stroke="rgba(240,246,252,0.25)" strokeWidth="0.75">
              <line x1={MARGIN.left} y1={shapeTop} x2={MARGIN.left} y2={shapeTop - 34} />
              <line x1={MARGIN.left + shapeW} y1={shapeTop} x2={MARGIN.left + shapeW} y2={shapeTop - 34} />
              <line x1={MARGIN.left} y1={shapeTop} x2={MARGIN.left - 80} y2={shapeTop} />
              <line x1={MARGIN.left} y1={flangeBottomY} x2={MARGIN.left - 46} y2={flangeBottomY} />
              <line x1={MARGIN.left} y1={shapeBottom} x2={MARGIN.left - 80} y2={shapeBottom} />
              <line x1={MARGIN.left + dims.webLeft * SCALE} y1={shapeBottom} x2={MARGIN.left + dims.webLeft * SCALE} y2={shapeBottom + 26} />
              <line x1={MARGIN.left + (dims.webLeft + dims.webWidth) * SCALE} y1={shapeBottom} x2={MARGIN.left + (dims.webLeft + dims.webWidth) * SCALE} y2={shapeBottom + 26} />
            </g>

            {/* dimension annotations */}
            <DimH x1={MARGIN.left} x2={MARGIN.left + shapeW} y={shapeTop - 28} label={`${Math.round(dims.flangeWidth * 1000)}`} />
            <DimV y1={shapeTop} y2={flangeBottomY} x={MARGIN.left - 38} label={`${Math.round(dims.flangeDepth * 1000)}`} />
            <DimV y1={shapeTop} y2={shapeBottom} x={MARGIN.left - 72} label={`${Math.round(dims.totalDepth * 1000)}`} />
            <DimH x1={MARGIN.left + dims.webLeft * SCALE} x2={MARGIN.left + (dims.webLeft + dims.webWidth) * SCALE} y={shapeBottom + 20} label={`${Math.round(dims.webWidth * 1000)}`} />

            {/* web centreline marker */}
            <line x1={webMidX} y1={shapeBottom + 8} x2={webMidX} y2={shapeBottom - 8} stroke="rgba(240,246,252,0.4)" strokeDasharray="2 2" />
          </svg>
        </div>

        {/* vertical temperature legend — shared component, DEF marker on */}
        <div className="flex flex-col items-center py-4 pr-4 pl-1 shrink-0">
          <ThermalLegend defLimit_c={def_limit} />
        </div>
      </div>

      {/* history chart */}
      <HistoryChart sim={sim} timeIndex={timeIndex} />
    </div>
  );
}
