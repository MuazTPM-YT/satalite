// thermal history and the threshold comparisons.
//
// This panel ANNOTATES. It states the measured value, the threshold, and where the
// threshold comes from. It never says a pour will crack or is safe to strip - that call
// belongs to the engineer reading it, not to the chart.
//
// Everything drawn is a field of the response. Nothing is derived, smoothed or filled.
"use client";

import type { SimulationResult, TrippedBy } from "@/lib/api";

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

const W = 920;
const ML = 46;
const MR = 62;

export default function HistoryChart({ sim, frameIndex }: HistoryChartProps) {
  const max_h = sim.times_h[sim.times_h.length - 1] ?? 0;
  const x = (h: number) => ML + (max_h > 0 ? h / max_h : 0) * (W - ML - MR);

  // the "now" marker lives on the FIELD frame cadence; map it back to the full series
  const seriesIdx = sim.fields
    ? sim.fields.frame_indices[Math.min(frameIndex, sim.fields.frame_indices.length - 1)]
    : 0;
  const now_h = sim.times_h[seriesIdx] ?? 0;

  const tick_hs = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max_h);

  return (
    <div className="border-t border-border-default bg-bg-surface px-4 py-2">
      <TemperatureTrack sim={sim} x={x} now_h={now_h} seriesIdx={seriesIdx} tick_hs={tick_hs} />
      <DifferentialTrack sim={sim} x={x} now_h={now_h} tick_hs={tick_hs} />

      {/* why each flag reads the way it does, in the response's own terms */}
      <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-text-muted">
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
        <span className="tabular-nums">
          peak_core_time_h {sim.peak_core_time_h.toFixed(1)} h
        </span>
        <span className="tabular-nums">t_ref {sim.t_ref_c.toFixed(1)} °C</span>
      </div>
    </div>
  );
}

// core, surface and strength against time, with the DEF threshold and the two peaks it
// is tested against.
function TemperatureTrack({
  sim,
  x,
  now_h,
  seriesIdx,
  tick_hs,
}: {
  sim: SimulationResult;
  x: (h: number) => number;
  now_h: number;
  seriesIdx: number;
  tick_hs: number[];
}) {
  const H = 178;
  const mt = 10;
  const mb = 22;
  const def_c = sim.breaches.def_threshold_c;

  const values = [
    ...sim.core_temp_c,
    ...sim.surface_temp_c,
    def_c,
    sim.max_core_temp_anywhere_c,
  ];
  const T_MIN = Math.floor(Math.min(...values) / 10) * 10;
  const T_MAX = Math.ceil(Math.max(...values) / 10) * 10;

  const y = (t: number) => mt + ((T_MAX - t) / (T_MAX - T_MIN || 1)) * (H - mt - mb);
  const strY = (p: number) => mt + (1 - p / 100) * (H - mt - mb);
  const path = (vals: number[], f: (v: number) => number) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(sim.times_h[i]).toFixed(1)} ${f(v).toFixed(1)}`).join(" ");

  const ticks: number[] = [];
  for (let t = T_MIN; t <= T_MAX; t += 10) ticks.push(t);

  return (
    <>
      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
          Thermal history
        </span>
        <Key color="#f0883e" label="core_temp_c (probe)" />
        <Key color="#58a6ff" label="surface_temp_c" />
        <Key color="#3fb950" label="strength_fraction" dashed />
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }} role="img" aria-label="Core and surface temperature against time">
        <line x1={ML} y1={mt} x2={ML} y2={H - mb} stroke="rgba(240,246,252,0.25)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ML} y1={y(t)} x2={W - MR} y2={y(t)} stroke="rgba(240,246,252,0.08)" />
            <text x={ML - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="rgba(240,246,252,0.45)">{t}</text>
          </g>
        ))}
        <text x={ML - 6} y={mt - 1} textAnchor="end" fontSize="8" fill="rgba(240,246,252,0.35)">°C</text>

        <line x1={W - MR} y1={mt} x2={W - MR} y2={H - mb} stroke="rgba(63,185,80,0.4)" />
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line x1={W - MR} y1={strY(p)} x2={W - MR + 4} y2={strY(p)} stroke="rgba(63,185,80,0.4)" />
            <text x={W - MR + 7} y={strY(p) + 3} fontSize="9" fill="#3fb950" opacity={0.75}>{p}%</text>
          </g>
        ))}

        <line x1={ML} y1={H - mb} x2={W - MR} y2={H - mb} stroke="rgba(240,246,252,0.25)" />
        {tick_hs.map((h) => (
          <g key={h}>
            <line x1={x(h)} y1={H - mb} x2={x(h)} y2={H - mb + 4} stroke="rgba(240,246,252,0.3)" />
            <text x={x(h)} y={H - mb + 15} textAnchor="middle" fontSize="9" fill="rgba(240,246,252,0.45)">{h.toFixed(0)}h</text>
          </g>
        ))}

        {/* the two quantities the DEF flag is tested against, drawn where they peak */}
        <Marker y={y(sim.max_core_temp_anywhere_c)} color="#d29922"
          label={`max_core_temp_anywhere_c ${sim.max_core_temp_anywhere_c.toFixed(2)} °C`} />
        <Marker y={y(sim.peak_core_temp_c)} color="#f0883e" labelX={ML + 300}
          label={`peak_core_temp_c ${sim.peak_core_temp_c.toFixed(2)} °C`} />

        {/* the threshold, with its source */}
        <Threshold y={y(def_c)} label={`DEF ${def_c} °C · USBR DSO-12-02 (155 °F design max)`} />

        <path d={path(sim.strength_fraction.map((s) => s * 100), strY)} fill="none" stroke="#3fb950" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={path(sim.surface_temp_c, y)} fill="none" stroke="#58a6ff" strokeWidth="1.5" />
        <path d={path(sim.core_temp_c, y)} fill="none" stroke="#f0883e" strokeWidth="2" />

        <line x1={x(now_h)} y1={mt} x2={x(now_h)} y2={H - mb} stroke="rgba(240,246,252,0.6)" strokeWidth="1" strokeDasharray="4 4" />
        <circle cx={x(now_h)} cy={y(sim.core_temp_c[seriesIdx] ?? 0)} r="3" fill="#f0883e" />
        <circle cx={x(now_h)} cy={y(sim.surface_temp_c[seriesIdx] ?? 0)} r="3" fill="#58a6ff" />
      </svg>
    </>
  );
}

// the cracking limit is a GAP, not a level, so it cannot share the temperature axis -
// 19.4 °C plotted next to a 60 °C core would read as a threshold the core is nowhere
// near. It gets its own axis, in °C of differential.
function DifferentialTrack({
  sim,
  x,
  now_h,
  tick_hs,
}: {
  sim: SimulationResult;
  x: (h: number) => number;
  now_h: number;
  tick_hs: number[];
}) {
  const H = 108;
  const mt = 14;
  const mb = 20;
  const limit_c = sim.breaches.cracking_limit_c;

  const D_MAX = Math.ceil(Math.max(limit_c, sim.max_anywhere_surface_diff_c, sim.max_core_surface_diff_c) * 1.2 / 5) * 5;
  const y = (d: number) => mt + ((D_MAX - d) / (D_MAX || 1)) * (H - mt - mb);

  const ticks: number[] = [];
  for (let d = 0; d <= D_MAX; d += D_MAX > 30 ? 20 : 10) ticks.push(d);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
          Core–surface differential
        </span>
        <span className="text-[10px] text-text-muted">
          the response carries the maxima over the run, not a differential series — no curve is drawn
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 104 }} role="img" aria-label="Core to surface differential against the cracking limit">
        <line x1={ML} y1={mt} x2={ML} y2={H - mb} stroke="rgba(240,246,252,0.25)" />
        {ticks.map((d) => (
          <g key={d}>
            <line x1={ML} y1={y(d)} x2={W - MR} y2={y(d)} stroke="rgba(240,246,252,0.08)" />
            <text x={ML - 6} y={y(d) + 3} textAnchor="end" fontSize="9" fill="rgba(240,246,252,0.45)">{d}</text>
          </g>
        ))}
        <text x={ML - 6} y={mt - 1} textAnchor="end" fontSize="8" fill="rgba(240,246,252,0.35)">ΔT °C</text>

        <line x1={ML} y1={H - mb} x2={W - MR} y2={H - mb} stroke="rgba(240,246,252,0.25)" />
        {tick_hs.map((h) => (
          <line key={h} x1={x(h)} y1={H - mb} x2={x(h)} y2={H - mb + 4} stroke="rgba(240,246,252,0.3)" />
        ))}

        <Marker y={y(sim.max_anywhere_surface_diff_c)} color="#d29922"
          label={`max_anywhere_surface_diff_c ${sim.max_anywhere_surface_diff_c.toFixed(2)} °C`} />
        <Marker y={y(sim.max_core_surface_diff_c)} color="#f0883e" labelX={ML + 320}
          label={`max_core_surface_diff_c ${sim.max_core_surface_diff_c.toFixed(2)} °C`} />

        <Threshold y={y(limit_c)} label={`cracking ${limit_c} °C · 35 °F, ACI 207`} />

        <line x1={x(now_h)} y1={mt} x2={x(now_h)} y2={H - mb} stroke="rgba(240,246,252,0.25)" strokeWidth="1" strokeDasharray="4 4" />
      </svg>
    </div>
  );
}

// a measured value, drawn where it sits
function Marker({
  y,
  color,
  label,
  labelX = ML + 4,
}: {
  y: number;
  color: string;
  label: string;
  labelX?: number;
}) {
  return (
    <g>
      <line x1={ML} y1={y} x2={W - MR} y2={y} stroke={color} strokeWidth="1" strokeDasharray="2 3" opacity={0.75} />
      <text x={labelX} y={y - 3} fontSize="9" fill={color} className="tabular-nums">{label}</text>
    </g>
  );
}

// a limit, drawn with the standard it comes from
function Threshold({ y, label }: { y: number; label: string }) {
  return (
    <g>
      <line x1={ML} y1={y} x2={W - MR} y2={y} stroke="#f85149" strokeWidth="1" strokeDasharray="6 4" />
      <text x={W - MR - 4} y={y - 4} textAnchor="end" fontSize="9" fill="#f85149" className="tabular-nums">{label}</text>
    </g>
  );
}

function Key({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-text-secondary">
      <span className="w-3 h-0.5 rounded" style={{ background: color, opacity: dashed ? 0.6 : 1 }} />
      {label}
    </span>
  );
}
