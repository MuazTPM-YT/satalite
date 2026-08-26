// Thermal history — the scopes row.
//
// This dock ANNOTATES. It states the measured value, the threshold, and where the
// threshold comes from. It never says a pour will crack or is safe to strip - that
// call belongs to the engineer reading it, not to the chart.
//
// Everything drawn is a field of the response. Nothing is derived, smoothed or filled.
//
// Three panels rather than one: temperature, strength and differential are three
// different quantities in three different units. They used to share a plot, with
// strength on a second right-hand axis - which silently invites the reader to
// compare a curve in °C against a curve in %, a comparison that means nothing. Small
// multiples on a shared time axis let them be read together without pretending they
// live on the same scale.
"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Maximize2, X } from "lucide-react";
import type { SimulationResult, TrippedBy } from "@/lib/api";
import { SectionLabel, ToolbarToggle, cx } from "@/components/ui";

interface HistoryChartProps {
  sim: SimulationResult;
  // index into sim.fields.times_h, used only to place the "now" marker.
  frameIndex: number;
}

// which quantity crossed, in words.
const TRIPPED: Record<TrippedBy, string> = {
  probe: "the probe only",
  max_anywhere: "the hottest point only",
  both: "the probe and the hottest point",
  none: "neither",
};

/* Series colours. Validated as a categorical set against the dock surface
   (#101213) for lightness band, chroma floor, CVD separation and contrast - the
   two temperature series are the only pair that ever share a plot. */
const CORE = "#da720d";
const SURFACE = "#5d82e9";
const STRENGTH = "#00a99c";
const LIMIT = "#e5484d";
const MEASURED = "#c2933c";

/**
 * A plot's own coordinate system.
 *
 * The dock and the expanded panel draw the same tracks at two very different sizes,
 * and a single viewBox could not serve both: scaling a 520-unit box up to fill the
 * screen scales its 9-unit type with it, and the threshold caption came out three
 * times the height of the axis numbers. Two geometries, one set of drawing code —
 * the type is sized in the box it is drawn in.
 */
interface Geom {
  W: number;
  H: number;
  ML: number;
  MR: number;
  MT: number;
  MB: number;
  /** axis and annotation type size, in this box's own units */
  font: number;
  /** curve stroke width, likewise */
  stroke: number;
  /** hover marker radius */
  dot: number;
}

const DOCK: Geom = { W: 520, H: 168, ML: 40, MR: 12, MT: 12, MB: 24, font: 9, stroke: 2, dot: 3.5 };
const FULL: Geom = { W: 1240, H: 560, ML: 76, MR: 28, MT: 28, MB: 52, font: 13, stroke: 3, dot: 5 };

/** The three panels, by the quantity each one plots. */
export type TrackId = "temperature" | "strength" | "differential";

const TRACK_TITLE: Record<TrackId, string> = {
  temperature: "Temperature",
  strength: "Strength fraction",
  differential: "Core–surface differential",
};

const TRACK_UNIT: Record<TrackId, string> = {
  temperature: "°C",
  strength: "% of f'c",
  differential: "ΔT °C",
};

const GRID = "rgba(255,255,255,0.06)";
const AXIS = "rgba(255,255,255,0.22)";
const INK = "rgba(255,255,255,0.45)";

export default function HistoryChart({ sim, frameIndex }: HistoryChartProps) {
  const [open, setOpen] = useState(true);
  // hover time in hours, or null. Shared across all three panels so one pointer
  // reads every quantity at the same instant.
  const [hover, setHover] = useState<number | null>(null);
  // Which panel, if any, is filling the screen.
  //
  // The dock gives each track about 150 px of height, which is enough to see the
  // shape of a curve and not enough to read a crossing off it. Expanding re-renders
  // the SAME track into the whole viewport - the viewBox does the zooming, so every
  // annotation, threshold and tick grows with it rather than staying at dock size on
  // a bigger picture.
  const [zoomed, setZoomed] = useState<TrackId | null>(null);

  const max_h = sim.times_h[sim.times_h.length - 1] ?? 0;
  // Time to x, in whichever box the track is being drawn in.
  const xIn = (g: Geom) => (h: number) =>
    g.ML + (max_h > 0 ? h / max_h : 0) * (g.W - g.ML - g.MR);

  // the "now" marker lives on the FIELD frame cadence; map it back to the full series
  const seriesIdx = sim.fields
    ? sim.fields.frame_indices[Math.min(frameIndex, sim.fields.frame_indices.length - 1)]
    : 0;
  const now_h = sim.times_h[seriesIdx] ?? 0;

  const tick_hs = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max_h);

  // nearest sample to a hovered time — the series is what exists, so the readout
  // never interpolates a value the solver did not produce.
  const hoverIdx =
    hover === null
      ? null
      : sim.times_h.reduce(
          (best, t, i) =>
            Math.abs(t - hover) < Math.abs(sim.times_h[best] - hover) ? i : best,
          0,
        );

  const track = { xIn, tick_hs, now_h, hover, hoverIdx, setHover, max_h, sim };

  // Escape closes the expanded panel, the way it closes every other transient
  // surface in the studio.
  const close = useCallback(() => setZoomed(null), []);
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed, close]);

  return (
    <section className="shrink-0 border-t border-border-default bg-bg-surface">
      <header className="flex items-center gap-4 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-md text-text-secondary hover:text-text-primary"
        >
          <ChevronDown
            className={cx(
              "h-3.5 w-3.5 transition-transform duration-200",
              !open && "-rotate-90",
            )}
            strokeWidth={2.5}
          />
          <SectionLabel>Thermal history</SectionLabel>
        </button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Key color={CORE} label="core_temp_c" />
          <Key color={SURFACE} label="surface_temp_c" />
          <Key color={STRENGTH} label="strength_fraction" />
          <Key color={LIMIT} label="threshold" dashed />
        </div>

        <div className="ml-auto hidden shrink-0 items-center gap-4 font-mono text-[10px] tabular-nums text-text-muted xl:flex">
          <span>peak_core_time_h {sim.peak_core_time_h.toFixed(1)} h</span>
          <span>t_ref {sim.t_ref_c.toFixed(1)} °C</span>
        </div>
      </header>

      {open && (
        <>
          {/* Three across on a wide screen. Narrower, they SCROLL sideways rather
              than stacking: stacked, the dock was 570 px of a 656 px window and the
              viewer it annotates had nothing left to be. */}
          <div
            className={cx(
              "flex snap-x snap-mandatory gap-px overflow-x-auto border-t border-border-default bg-border-default",
              "lg:grid lg:grid-cols-3 lg:overflow-x-visible",
            )}
          >
            <TemperatureTrack {...track} onZoom={setZoomed} />
            <StrengthTrack {...track} onZoom={setZoomed} />
            <DifferentialTrack {...track} onZoom={setZoomed} />
          </div>

          {/* why each flag reads the way it does, in the response's own terms */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 text-[10px] text-text-muted">
            <span>
              DEF crossed by{" "}
              <span className={sim.breaches.def_risk ? "text-status-amber" : "text-text-secondary"}>
                {TRIPPED[sim.breaches.def_tripped_by]}
              </span>
            </span>
            <span>
              Cracking differential crossed by{" "}
              <span className={sim.breaches.cracking ? "text-status-amber" : "text-text-secondary"}>
                {TRIPPED[sim.breaches.cracking_tripped_by]}
              </span>
            </span>
          </div>
        </>
      )}

      {/* The expanded panel. A backdrop rather than a palette: this is one thing to
          read, not one more surface to arrange, and it goes away on Escape, on the
          close button, or on a click outside the plot. */}
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${TRACK_TITLE[zoomed]} — expanded`}
          onClick={close}
          className="fixed inset-0 z-[900] flex flex-col bg-bg-primary/90 p-4 backdrop-blur-sm sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-2xl shadow-black/60"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-border-default bg-elevate-1 px-4 py-2">
              <SectionLabel>{TRACK_TITLE[zoomed]}</SectionLabel>
              <span className="font-mono text-[10px] text-text-muted">{TRACK_UNIT[zoomed]}</span>
              <div className="ml-auto flex items-center gap-4">
                <span className="hidden font-mono text-[10px] tabular-nums text-text-muted sm:inline">
                  0 – {max_h.toFixed(0)} h after placement
                </span>
                <ToolbarToggle icon={X} label="Close the expanded chart" onClick={close} />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-2">
              {zoomed === "temperature" && <TemperatureTrack {...track} tall />}
              {zoomed === "strength" && <StrengthTrack {...track} tall />}
              {zoomed === "differential" && <DifferentialTrack {...track} tall />}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Shared track chrome ────────────────────────────────────────────────────── */

interface TrackProps {
  sim: SimulationResult;
  /** time to x, bound to the box the track is about to be drawn in */
  xIn: (g: Geom) => (h: number) => number;
  tick_hs: number[];
  now_h: number;
  max_h: number;
  hover: number | null;
  hoverIdx: number | null;
  setHover: (h: number | null) => void;
  /** offered in the dock, absent in the expanded copy — it is already expanded */
  onZoom?: (id: TrackId) => void;
  /** render at full height rather than at dock height */
  tall?: boolean;
}

/** A titled panel with a readout slot, wrapping one plot. */
function Track({
  id,
  readout,
  children,
  onHover,
  onLeave,
  onZoom,
  tall,
}: {
  id: TrackId;
  readout?: React.ReactNode;
  children: React.ReactNode;
  onHover: (e: React.PointerEvent<SVGSVGElement>) => void;
  onLeave: () => void;
  onZoom?: (id: TrackId) => void;
  tall?: boolean;
}) {
  const title = TRACK_TITLE[id];
  const unit = TRACK_UNIT[id];
  const g = tall ? FULL : DOCK;
  return (
    <div
      className={cx(
        "flex flex-col bg-bg-surface px-3 pb-1 pt-2",
        tall
          ? "min-h-0 flex-1"
          // basis-0 + grow so the three share the row evenly once they are a grid,
          // and a floor wide enough that a scrolled one is still a readable plot.
          : "w-[min(100%,26rem)] shrink-0 snap-start lg:w-auto lg:min-w-0",
      )}
    >
      {/* Expanded, the dialog's own header already names the plot and its unit, so
          this row keeps only the readout — at a size that belongs to the picture it
          is annotating rather than to the dock it came from. */}
      <div className="mb-0.5 flex shrink-0 items-center gap-2">
        {!tall && (
          <>
            <SectionLabel>{title}</SectionLabel>
            <span className="font-mono text-[9px] text-text-muted">{unit}</span>
          </>
        )}
        <span
          className={cx(
            "ml-auto min-w-0 truncate font-mono tabular-nums text-text-primary",
            tall ? "text-[13px]" : "text-[10px]",
          )}
        >
          {readout}
        </span>
        {onZoom && (
          <ToolbarToggle
            icon={Maximize2}
            label={`Expand ${title.toLowerCase()}`}
            hint="Fill the screen. Escape closes it."
            onClick={() => onZoom(id)}
          />
        )}
      </div>
      <svg
        viewBox={`0 0 ${g.W} ${g.H}`}
        className={cx("w-full touch-none", tall ? "min-h-0 flex-1" : "h-[150px]")}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onHover}
        onPointerLeave={onLeave}
        role="img"
        aria-label={`${title} against time, in ${unit}`}
      >
        {children}
      </svg>
    </div>
  );
}

/** x-axis, y grid + labels — identical on every track so they read as one instrument. */
function Frame({
  ticks,
  y,
  fmt,
  tick_hs,
  x,
  g,
}: {
  ticks: number[];
  y: (v: number) => number;
  fmt: (v: number) => string;
  tick_hs: number[];
  x: (h: number) => number;
  g: Geom;
}) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={g.ML} y1={y(t)} x2={g.W - g.MR} y2={y(t)} stroke={GRID} />
          <text
            x={g.ML - g.font * 0.7}
            y={y(t) + g.font / 3}
            textAnchor="end"
            fontSize={g.font}
            fill={INK}
            fontFamily="var(--font-mono)"
          >
            {fmt(t)}
          </text>
        </g>
      ))}
      <line x1={g.ML} y1={g.MT} x2={g.ML} y2={g.H - g.MB} stroke={AXIS} />
      <line x1={g.ML} y1={g.H - g.MB} x2={g.W - g.MR} y2={g.H - g.MB} stroke={AXIS} />
      {tick_hs.map((h) => (
        <g key={h}>
          <line x1={x(h)} y1={g.H - g.MB} x2={x(h)} y2={g.H - g.MB + g.font * 0.45} stroke={AXIS} />
          <text
            x={x(h)}
            y={g.H - g.MB + g.font * 1.7}
            textAnchor="middle"
            fontSize={g.font}
            fill={INK}
            fontFamily="var(--font-mono)"
          >
            {h.toFixed(0)}h
          </text>
        </g>
      ))}
    </>
  );
}

/** The scrubbed frame and, when hovering, the pointer's own time. */
function Cursors({
  x,
  now_h,
  hover,
  g,
}: {
  x: (h: number) => number;
  now_h: number;
  hover: number | null;
  g: Geom;
}) {
  const w = g.stroke / 2;
  return (
    <>
      <line
        x1={x(now_h)}
        y1={g.MT}
        x2={x(now_h)}
        y2={g.H - g.MB}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={w}
        strokeDasharray={`${g.font * 0.45} ${g.font * 0.45}`}
      />
      {hover !== null && (
        <line x1={x(hover)} y1={g.MT} x2={x(hover)} y2={g.H - g.MB} stroke="#7599fa" strokeWidth={w} />
      )}
    </>
  );
}

/** Turn a pointer event into a time in hours, clamped to the plot area. */
function useHourFromPointer(max_h: number, g: Geom) {
  return (e: React.PointerEvent<SVGSVGElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    // the viewBox is letterboxed by xMidYMid meet — recover the mapping
    const k = Math.min(r.width / g.W, r.height / g.H);
    const ox = (r.width - g.W * k) / 2;
    const vx = (e.clientX - r.left - ox) / k;
    const f = (vx - g.ML) / (g.W - g.ML - g.MR);
    return Math.max(0, Math.min(1, f)) * max_h;
  };
}

/* ── Tracks ─────────────────────────────────────────────────────────────────── */

/** Core and surface temperature against the DEF threshold. */
function TemperatureTrack({ sim, xIn, tick_hs, now_h, max_h, hover, hoverIdx, setHover, onZoom, tall }: TrackProps) {
  const g = tall ? FULL : DOCK;
  const x = xIn(g);
  const def_c = sim.breaches.def_threshold_c;
  const values = [...sim.core_temp_c, ...sim.surface_temp_c, def_c, sim.max_core_temp_anywhere_c];
  const T_MIN = Math.floor(Math.min(...values) / 10) * 10;
  const T_MAX = Math.ceil(Math.max(...values) / 10) * 10;
  const y = (t: number) => g.MT + ((T_MAX - t) / (T_MAX - T_MIN || 1)) * (g.H - g.MT - g.MB);

  const ticks: number[] = [];
  for (let t = T_MIN; t <= T_MAX; t += 10) ticks.push(t);

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(sim.times_h[i]).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const at = hoverIdx ?? null;
  const toHour = useHourFromPointer(max_h, g);

  return (
    <Track
      id="temperature"
      onZoom={onZoom}
      tall={tall}
      onHover={(e) => setHover(toHour(e))}
      onLeave={() => setHover(null)}
      readout={
        at !== null ? (
          <>
            <span style={{ color: CORE }}>{sim.core_temp_c[at]?.toFixed(2)}</span>
            {" / "}
            <span style={{ color: SURFACE }}>{sim.surface_temp_c[at]?.toFixed(2)}</span>
            <span className="text-text-muted"> @ {sim.times_h[at]?.toFixed(1)} h</span>
          </>
        ) : (
          <span className="text-text-muted">peak {sim.peak_core_temp_c.toFixed(2)} °C</span>
        )
      }
    >
      <Frame ticks={ticks} y={y} fmt={(v) => String(v)} tick_hs={tick_hs} x={x} g={g} />

      {/* the two quantities the DEF flag is tested against, drawn where they peak */}
      <Measured
        y={y(sim.max_core_temp_anywhere_c)}
        label={`max anywhere ${sim.max_core_temp_anywhere_c.toFixed(2)}`}
        g={g}
      />
      <Threshold y={y(def_c)} label={`DEF ${def_c} °C · USBR DSO-12-02`} g={g} />

      <path d={path(sim.surface_temp_c)} fill="none" stroke={SURFACE} strokeWidth={g.stroke} strokeLinejoin="round" />
      <path d={path(sim.core_temp_c)} fill="none" stroke={CORE} strokeWidth={g.stroke} strokeLinejoin="round" />

      <Cursors x={x} now_h={now_h} hover={hover} g={g} />
      {at !== null && (
        <>
          <Dot cx={x(sim.times_h[at])} cy={y(sim.core_temp_c[at])} fill={CORE} g={g} />
          <Dot cx={x(sim.times_h[at])} cy={y(sim.surface_temp_c[at])} fill={SURFACE} g={g} />
        </>
      )}
    </Track>
  );
}

/** Strength development. Its own panel because % and °C are not comparable. */
function StrengthTrack({ sim, xIn, tick_hs, now_h, max_h, hover, hoverIdx, setHover, onZoom, tall }: TrackProps) {
  const g = tall ? FULL : DOCK;
  const x = xIn(g);
  const y = (p: number) => g.MT + (1 - p / 100) * (g.H - g.MT - g.MB);
  const ticks = [0, 25, 50, 75, 100];
  const path = sim.strength_fraction
    .map((s, i) => `${i === 0 ? "M" : "L"}${x(sim.times_h[i]).toFixed(1)} ${y(s * 100).toFixed(1)}`)
    .join(" ");

  const at = hoverIdx ?? null;
  const toHour = useHourFromPointer(max_h, g);

  return (
    <Track
      id="strength"
      onZoom={onZoom}
      tall={tall}
      onHover={(e) => setHover(toHour(e))}
      onLeave={() => setHover(null)}
      readout={
        at !== null ? (
          <>
            <span style={{ color: STRENGTH }}>
              {((sim.strength_fraction[at] ?? 0) * 100).toFixed(1)}%
            </span>
            <span className="text-text-muted"> @ {sim.times_h[at]?.toFixed(1)} h</span>
          </>
        ) : (
          <span className="text-text-muted">
            final {((sim.strength_fraction[sim.strength_fraction.length - 1] ?? 0) * 100).toFixed(1)}%
          </span>
        )
      }
    >
      <Frame ticks={ticks} y={y} fmt={(v) => `${v}`} tick_hs={tick_hs} x={x} g={g} />
      <path d={path} fill="none" stroke={STRENGTH} strokeWidth={g.stroke} strokeLinejoin="round" />
      <Cursors x={x} now_h={now_h} hover={hover} g={g} />
      {at !== null && (
        <Dot cx={x(sim.times_h[at])} cy={y((sim.strength_fraction[at] ?? 0) * 100)} fill={STRENGTH} g={g} />
      )}
    </Track>
  );
}

// The cracking limit is a GAP, not a level, so it cannot share the temperature axis -
// 19.4 °C plotted next to a 60 °C core would read as a threshold the core is nowhere
// near. It gets its own axis, in °C of differential.
function DifferentialTrack({
  sim,
  xIn,
  tick_hs,
  now_h,
  max_h,
  hover,
  hoverIdx,
  setHover,
  onZoom,
  tall,
}: TrackProps) {
  const g = tall ? FULL : DOCK;
  const x = xIn(g);
  const limit_c = sim.breaches.cracking_limit_c;

  // The differential at the probe, over time.
  //
  // This panel used to say "maxima only - no series in the response" and draw three
  // horizontal lines. The series was there all along: physics/solver.py computes
  // max_core_surface_diff_c as max(core_arr - surface_arr), and BOTH arrays ship in the
  // response. So this is not a new measurement, it is the series the scalar was reduced
  // from - and its maximum is that scalar, exactly, which is what test_studio_live.ts
  // asserts.
  //
  // Drawing it turns "the gradient peaked at 29.03" into "and here is when, how long it
  // stayed over ACI 207, and when it came back down", which is the question the limit is
  // actually asked. A number cannot answer it; a curve can.
  const diff_c = sim.core_temp_c.map((c, i) => c - (sim.surface_temp_c[i] ?? c));

  // The axis has to hold NEGATIVES. On the demo day 84 of 433 samples are below zero,
  // down to -4.29 °C: in the afternoon the sun drives the surface hotter than the core,
  // so the gradient inverts and heat flows inward. An axis floored at zero silently drew
  // a fifth of the series below the frame. The sign is physical, so zero is ruled.
  const lo = Math.min(0, ...diff_c);
  const hi = Math.max(limit_c, sim.max_anywhere_surface_diff_c, sim.max_core_surface_diff_c);
  const D_MAX = Math.ceil((hi * 1.2) / 5) * 5;
  const D_MIN = Math.floor(lo / 5) * 5;
  const span = D_MAX - D_MIN || 1;
  const y = (d: number) => g.MT + ((D_MAX - d) / span) * (g.H - g.MT - g.MB);

  const ticks: number[] = [];
  const stepD = span > 40 ? 20 : 10;
  for (let d = Math.ceil(D_MIN / stepD) * stepD; d <= D_MAX; d += stepD) ticks.push(d);

  const path = diff_c
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(sim.times_h[i]).toFixed(1)} ${y(d).toFixed(1)}`)
    .join(" ");

  const at = hoverIdx ?? null;
  const toHour = useHourFromPointer(max_h, g);

  return (
    <Track
      id="differential"
      onZoom={onZoom}
      tall={tall}
      onHover={(e) => setHover(toHour(e))}
      onLeave={() => setHover(null)}
      readout={
        at !== null ? (
          <>
            <span style={{ color: CORE }}>{(diff_c[at] ?? 0).toFixed(2)}</span>
            <span className="text-text-muted"> @ {sim.times_h[at]?.toFixed(1)} h</span>
          </>
        ) : (
          <span className="text-text-muted">
            peak {sim.max_core_surface_diff_c.toFixed(2)} °C at the probe
          </span>
        )
      }
    >
      <Frame ticks={ticks} y={y} fmt={(v) => String(v)} tick_hs={tick_hs} x={x} g={g} />

      {/* Zero, drawn only when the series actually crosses it. Below this line the
          surface is HOTTER than the core and the gradient has inverted, which is a
          different physical state, not a smaller number. */}
      {D_MIN < 0 && (
        <line
          x1={g.ML}
          y1={y(0)}
          x2={g.W - g.MR}
          y2={y(0)}
          stroke="var(--draft-line)"
          strokeWidth={g.stroke / 2}
        />
      )}

      {/* The hottest cell ANYWHERE against the surface. This one really has no series -
          the per-step maximum over the whole section is not in the response - so it
          stays a level, and it is the conservative number of the two. */}
      <Measured
        y={y(sim.max_anywhere_surface_diff_c)}
        label={`max anywhere ${sim.max_anywhere_surface_diff_c.toFixed(2)}`}
        g={g}
      />
      <Threshold y={y(limit_c)} label={`cracking ${limit_c} °C · ACI 207`} g={g} />

      <path
        d={path}
        fill="none"
        stroke={CORE}
        strokeWidth={g.stroke}
        strokeLinejoin="round"
      />

      <Cursors x={x} now_h={now_h} hover={hover} g={g} />
      {at !== null && <Dot cx={x(sim.times_h[at])} cy={y(diff_c[at] ?? 0)} fill={CORE} g={g} />}
    </Track>
  );
}

/* ── Marks ──────────────────────────────────────────────────────────────────── */

/** A measured maximum, drawn as a level where it sits. */
function Measured({
  y,
  label,
  color = MEASURED,
  g,
}: {
  y: number;
  label: string;
  color?: string;
  g: Geom;
}) {
  return (
    <g>
      <line
        x1={g.ML}
        y1={y}
        x2={g.W - g.MR}
        y2={y}
        stroke={color}
        strokeWidth={g.stroke / 2}
        strokeDasharray={`${g.font * 0.22} ${g.font * 0.33}`}
        opacity={0.8}
      />
      <text x={g.ML + g.font * 0.45} y={y - g.font * 0.45} fontSize={g.font} fill={color} fontFamily="var(--font-mono)">
        {label}
      </text>
    </g>
  );
}

/** A limit, drawn with the standard it comes from. */
function Threshold({ y, label, g }: { y: number; label: string; g: Geom }) {
  return (
    <g>
      <line
        x1={g.ML}
        y1={y}
        x2={g.W - g.MR}
        y2={y}
        stroke={LIMIT}
        strokeWidth={g.stroke / 2}
        strokeDasharray={`${g.font * 0.67} ${g.font * 0.45}`}
      />
      <text
        x={g.W - g.MR - g.font * 0.22}
        y={y - g.font * 0.45}
        textAnchor="end"
        fontSize={g.font}
        fill={LIMIT}
        fontFamily="var(--font-mono)"
      >
        {label}
      </text>
    </g>
  );
}

/** A sample marker. The surface-coloured ring keeps it legible over any curve. */
function Dot({ cx: x, cy, fill, g }: { cx: number; cy: number; fill: string; g: Geom }) {
  return <circle cx={x} cy={cy} r={g.dot} fill={fill} stroke="#101213" strokeWidth={g.stroke} />;
}

function Key({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-muted">
      <span
        className="h-0.5 w-3.5 shrink-0 rounded-full"
        style={{
          background: dashed
            ? `repeating-linear-gradient(to right, ${color} 0 3px, transparent 3px 5px)`
            : color,
        }}
      />
      {label}
    </span>
  );
}
