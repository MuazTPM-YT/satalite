// 2D section view. The SOLVED cross-section: geometry from outline_m, colour from the
// per-cell field, probe sampled the same way the backend samples its own.
"use client";

import { useMemo, useState } from "react";
import type { SimulationResult } from "@/lib/api";
import { sampleField, frameRange, type Sample } from "@/lib/probe";
import { tempToColor } from "@/lib/thermalColormap";
import ThermalLegend from "@/components/ThermalLegend";
import { camClass } from "@/components/Viewer";
import { fmtLen, type LengthUnit } from "@/lib/units";
import HistoryChart from "@/components/HistoryChart";

// discrete contour band width. 2D is stepped on purpose; 3D stays smooth.
const BAND_STEP_C = 5;
// longest side of the drawn section, px. The scale is derived from the real section so
// a 3 m slab and a 300 mm column both fit - nothing here is a per-shape constant.
const DRAW_PX = 620;
const MARGIN = { left: 96, top: 64, right: 24, bottom: 56 };

interface Section2DProps {
  sim: SimulationResult;
  // index into sim.fields.times_h, NOT into sim.times_h.
  frameIndex: number;
  length_m: number;
  units: LengthUnit;
}

// horizontal dimension line with end ticks and label
function DimH({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  return (
    <g stroke="currentColor" className="text-text-secondary" strokeWidth="1">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} />
      <line x1={x2} y1={y - 5} x2={x2} y2={y + 5} />
      <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" fontSize="11" stroke="none" fill="currentColor" className="tabular-nums">
        {label}
      </text>
    </g>
  );
}

// vertical dimension line with end ticks and label
function DimV({ y1, y2, x, label }: { y1: number; y2: number; x: number; label: string }) {
  return (
    <g stroke="currentColor" className="text-text-secondary" strokeWidth="1">
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - 5} y1={y1} x2={x + 5} y2={y1} />
      <line x1={x - 5} y1={y2} x2={x + 5} y2={y2} />
      <text x={x - 8} y={(y1 + y2) / 2} textAnchor="middle" fontSize="11" stroke="none" fill="currentColor" className="tabular-nums" transform={`rotate(-90 ${x - 8} ${(y1 + y2) / 2})`}>
        {label}
      </text>
    </g>
  );
}

export default function Section2D({ sim, frameIndex, length_m, units }: Section2DProps) {
  const [probe, setProbe] = useState<(Sample & { clicked: [number, number] }) | null>(null);
  const fields = sim.fields;

  // section extent in metres, from the solver's own grid. The outline is drawn in the
  // same absolute frame the grid uses, so a cell and a vertex cannot drift apart.
  const extent = useMemo(() => {
    const xs = sim.outline_m.map((p) => p[0]);
    const ys = sim.outline_m.map((p) => p[1]);
    const w = fields ? fields.nx * fields.dx_m : Math.max(...xs);
    const h = fields ? fields.ny * fields.dx_m : Math.max(...ys);
    return { w, h, scale: DRAW_PX / Math.max(w, h) };
  }, [sim.outline_m, fields]);

  const { w: w_m, h: h_m, scale } = extent;
  const shapeW = w_m * scale;
  const shapeH = h_m * scale;
  const svgW = MARGIN.left + shapeW + MARGIN.right;
  const svgH = MARGIN.top + shapeH + MARGIN.bottom;

  // metres -> svg px. y is flipped: the solver's row 0 is the base.
  const toPx = (x_m: number, y_m: number): [number, number] => [
    MARGIN.left + x_m * scale,
    MARGIN.top + (h_m - y_m) * scale,
  ];

  const frame = fields?.temp_c[Math.min(frameIndex, fields.temp_c.length - 1)];
  const current_h = fields?.times_h[Math.min(frameIndex, fields.times_h.length - 1)] ?? 0;

  // the real spread in THIS frame. Shown next to the fixed scale so a reader can see
  // how much of the gradient the colours are actually using.
  const range = useMemo(() => (frame ? frameRange(frame) : null), [frame]);

  // colour scale bounds. Fixed across the run so frames are comparable, and taken from
  // the run's own extremes rather than a hardcoded 25-75.
  const scaleBounds = useMemo(() => {
    if (!fields) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of fields.temp_c) {
      const r = frameRange(f);
      if (!r) continue;
      lo = Math.min(lo, r.min_c);
      hi = Math.max(hi, r.max_c);
    }
    if (lo === Infinity) return null;
    // widen to whole band steps so the legend ticks land on round numbers
    return {
      min_c: Math.floor(lo / BAND_STEP_C) * BAND_STEP_C,
      max_c: Math.ceil(hi / BAND_STEP_C) * BAND_STEP_C,
    };
  }, [fields]);

  // contour bands: one svg path per band, plus the lines between bands
  const drawing = useMemo(() => {
    if (!fields || !frame || !scaleBounds) return null;
    const { nx, ny, dx_m } = fields;
    const cell = dx_m * scale;
    const nBands = Math.max(1, Math.round((scaleBounds.max_c - scaleBounds.min_c) / BAND_STEP_C));

    const bandOf = (t: number) => {
      const clamped = Math.min(Math.max(t, scaleBounds.min_c), scaleBounds.max_c - 1e-9);
      return Math.min(nBands - 1, Math.floor((clamped - scaleBounds.min_c) / BAND_STEP_C));
    };

    const bands: number[][] = frame.map((row) => row.map((v) => (v === null ? -1 : bandOf(v))));
    const paths = new Map<number, string>();
    const bounds: string[] = [];

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const b = bands[j][i];
        if (b < 0) continue;
        const [px, py] = toPx(i * dx_m, (j + 1) * dx_m);
        const rect = `M${px.toFixed(1)} ${py.toFixed(1)}h${cell.toFixed(1)}v${cell.toFixed(1)}h-${cell.toFixed(1)}Z`;
        paths.set(b, (paths.get(b) ?? "") + rect);
        if (i + 1 < nx && bands[j][i + 1] >= 0 && bands[j][i + 1] !== b) {
          const [bx, by] = toPx((i + 1) * dx_m, (j + 1) * dx_m);
          bounds.push(`M${bx.toFixed(1)} ${by.toFixed(1)}v${cell.toFixed(1)}`);
        }
        if (j + 1 < ny && bands[j + 1][i] >= 0 && bands[j + 1][i] !== b) {
          const [bx, by] = toPx(i * dx_m, (j + 1) * dx_m);
          bounds.push(`M${bx.toFixed(1)} ${by.toFixed(1)}h${cell.toFixed(1)}`);
        }
      }
    }

    const bandColor = (band: number) => {
      const mid = scaleBounds.min_c + (band + 0.5) * BAND_STEP_C;
      const [r, g, b] = tempToColor(mid, scaleBounds.min_c, scaleBounds.max_c);
      return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    };

    return { entries: [...paths.entries()], bounds: bounds.join(""), bandColor, nBands };
    // toPx is derived from the same inputs as everything else in this block
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, frame, scaleBounds, scale, h_m]);

  const outlinePts = sim.outline_m
    .map(([x_m, y_m]) => toPx(x_m, y_m).map((v) => v.toFixed(1)).join(","))
    .join(" ");

  // click anywhere in the section -> bilinear sample at that physical point
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!fields || !frame) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    // viewBox is uniformly fitted with xMidYMid meet, so recover the letterboxing
    const k = Math.min(rect.width / svgW, rect.height / svgH);
    const ox = (rect.width - svgW * k) / 2;
    const oy = (rect.height - svgH * k) / 2;
    const vx = (e.clientX - rect.left - ox) / k;
    const vy = (e.clientY - rect.top - oy) / k;
    const x_m = (vx - MARGIN.left) / scale;
    const y_m = h_m - (vy - MARGIN.top) / scale;
    const s = sampleField(frame, fields.dx_m, x_m, y_m);
    setProbe(s ? { ...s, clicked: [x_m, y_m] } : null);
  };

  // jump the probe to the point the backend reported its own core temperature at
  const probeAtBackendPoint = () => {
    if (!fields || !frame) return;
    const [x_m, y_m] = sim.probe_xy_m;
    const s = sampleField(frame, fields.dx_m, x_m, y_m);
    setProbe(s ? { ...s, clicked: [x_m, y_m] } : null);
  };

  const peakFrameIdx = fields
    ? fields.frame_indices.indexOf(
        sim.core_temp_c.indexOf(Math.max(...sim.core_temp_c)),
      )
    : -1;
  const onPeakFrame = peakFrameIdx >= 0 && peakFrameIdx === frameIndex;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* header row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-0.5 bg-bg-primary rounded-sm p-0.5">
          <button aria-pressed={true} title="Section view" className={camClass(true)}>
            ◧ Front
          </button>
        </div>
        <div className="px-3 py-1 text-xs rounded-sm bg-bg-primary border border-border-default text-text-primary font-medium">
          Section A-A
        </div>
        <span className="text-xs text-text-secondary">
          any z (identical along the {fmtLen(length_m, units)} {units} length) ·{" "}
          <span className="font-semibold text-text-primary">{current_h.toFixed(1)} h</span>
          {onPeakFrame && <span className="ml-1 text-accent-blue">· peak core</span>}
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-text-muted">
          {fields
            ? `${fields.nx}x${fields.ny} cells @ ${(fields.dx_m * 1000).toFixed(0)} mm · bands ${BAND_STEP_C} °C`
            : "no per-cell field in this response"}
        </span>
      </div>

      {/* drawing + legend */}
      <div className="flex-1 flex min-h-0 bg-bg-primary">
        <div className="flex-1 flex flex-col items-center justify-center min-w-0 p-2">
          {!fields && (
            <p className="max-w-md text-center text-xs text-text-secondary leading-relaxed">
              This response carries no per-cell temperature field, so there is nothing to
              shade. The outline below is the solved section; the colours are simply absent,
              not zero. Request the run with <code className="text-text-primary">fields=true</code>.
            </p>
          )}
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
            onClick={handleClick}
            role="img"
            aria-label="Solved cross-section temperature contours"
          >
            {drawing?.entries.map(([band, d]) => (
              <path key={band} d={d} fill={drawing.bandColor(band)} />
            ))}
            {drawing && <path d={drawing.bounds} stroke="rgba(0,0,0,0.35)" strokeWidth="1" fill="none" />}
            <polygon points={outlinePts} fill="none" stroke="rgba(240,246,252,0.8)" strokeWidth="1.5" />

            {/* where the backend sampled its own core temperature */}
            {(() => {
              const [cx, cy] = toPx(sim.probe_xy_m[0], sim.probe_xy_m[1]);
              return (
                <g>
                  <circle cx={cx} cy={cy} r="4" fill="none" stroke="#f0f6fc" strokeWidth="1.2" />
                  <circle cx={cx} cy={cy} r="1.2" fill="#f0f6fc" />
                </g>
              );
            })()}

            {/* the clicked point */}
            {probe && (() => {
              const [cx, cy] = toPx(probe.xy_m[0], probe.xy_m[1]);
              return <circle cx={cx} cy={cy} r="3.5" fill="#58a6ff" stroke="#0d1117" strokeWidth="1" />;
            })()}

            {/* extension lines + overall dimensions, straight off the outline */}
            <g stroke="rgba(240,246,252,0.25)" strokeWidth="0.75">
              <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top - 34} />
              <line x1={MARGIN.left + shapeW} y1={MARGIN.top} x2={MARGIN.left + shapeW} y2={MARGIN.top - 34} />
              <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left - 60} y2={MARGIN.top} />
              <line x1={MARGIN.left} y1={MARGIN.top + shapeH} x2={MARGIN.left - 60} y2={MARGIN.top + shapeH} />
            </g>
            <DimH x1={MARGIN.left} x2={MARGIN.left + shapeW} y={MARGIN.top - 28} label={fmtLen(w_m, units)} />
            <DimV y1={MARGIN.top} y2={MARGIN.top + shapeH} x={MARGIN.left - 52} label={fmtLen(h_m, units)} />
          </svg>

          {/* probe readout */}
          <div className="w-full max-w-2xl mt-1 flex items-center gap-3 text-[11px] tabular-nums">
            <button
              type="button"
              onClick={probeAtBackendPoint}
              className="px-2 py-0.5 rounded-sm border border-border-default text-text-secondary hover:text-text-primary transition-colors"
            >
              Probe at backend point
            </button>
            {probe ? (
              <>
                <span className="text-text-primary font-semibold">{probe.temp_c.toFixed(2)} °C</span>
                <span className="text-text-muted">
                  at [{probe.xy_m[0].toFixed(3)}, {probe.xy_m[1].toFixed(3)}] m
                </span>
                {probe.fallback && (
                  <span className="text-status-amber">
                    nearest solid cell — the 2×2 straddled a hole or the outside
                  </span>
                )}
              </>
            ) : (
              <span className="text-text-muted">click the section to sample a point</span>
            )}
          </div>
          <div className="w-full max-w-2xl mt-0.5 text-[10px] text-text-muted tabular-nums">
            backend probe_xy_m [{sim.probe_xy_m[0].toFixed(3)}, {sim.probe_xy_m[1].toFixed(3)}] m ·
            peak_core_temp_c {sim.peak_core_temp_c.toFixed(2)} °C at {sim.peak_core_time_h.toFixed(1)} h
          </div>
        </div>

        {/* temperature legend, labelled with the real numbers */}
        <div className="flex flex-col items-center py-4 pr-4 pl-1 shrink-0">
          <ThermalLegend
            min_c={scaleBounds?.min_c}
            max_c={scaleBounds?.max_c}
            defLimit_c={sim.breaches.def_threshold_c}
            frameMin_c={range?.min_c}
            frameMax_c={range?.max_c}
          />
        </div>
      </div>

      <HistoryChart sim={sim} frameIndex={frameIndex} />
    </div>
  );
}
