// the precomputed ensemble band, and the one thing about it that must not read as a
// contradiction.
//
// The nominal DEF flag is false. The p95 band edge crosses the DEF threshold. Both are
// correct: one is a single deterministic run, the other is the upper tail of a sampled
// parameter space. A green flag sitting above a band that crosses the line looks like
// the tool arguing with itself unless the crossing is labelled, so it is labelled.
"use client";

import type { DemoEnsembleResponse, SimulationResult } from "@/lib/api";
import { SectionLabel } from "@/components/ui";

interface EnsemblePanelProps {
  demo: DemoEnsembleResponse;
  // the live deterministic solve, for the nominal comparison.
  nominal: SimulationResult;
  // whether that solve is still the scenario this band was computed for. Once the
  // inputs move off it, the band describes a different pour and says so.
  matchesDemo: boolean;
}

const W = 900;
const H = 260;
const ML = 46;
const MR = 16;
const MT = 14;
const MB = 26;

export default function EnsemblePanel({ demo, nominal, matchesDemo }: EnsemblePanelProps) {
  const e = demo.ensemble;
  const band = e.core_temp_c;
  const n = band.p50.length;
  const def_c = nominal.breaches.def_threshold_c;

  // the band carries no time axis of its own. The deterministic run solved the same
  // scenario over the same duration, so when the frame counts agree its times_h is the
  // axis; when they do not, say so rather than stretching one onto the other.
  const timesMatch = nominal.times_h.length === n;
  const t = (i: number) => (timesMatch ? nominal.times_h[i] : i);
  const t_max = t(n - 1);
  const x = (i: number) => ML + (t_max > 0 ? t(i) / t_max : 0) * (W - ML - MR);

  const lo = Math.min(...band.p05);
  const hi = Math.max(Math.max(...band.p95), def_c);
  const T_MIN = Math.floor(lo / 10) * 10;
  const T_MAX = Math.ceil(hi / 10) * 10;
  const y = (v: number) => MT + ((T_MAX - v) / (T_MAX - T_MIN || 1)) * (H - MT - MB);

  const area = (upper: number[], lower: number[]) =>
    upper.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ") +
    " " +
    lower
      .map((v, i) => `L${x(lower.length - 1 - i).toFixed(1)} ${y(lower[lower.length - 1 - i]).toFixed(1)}`)
      .join(" ") +
    " Z";

  const line = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  // where the upper edge sits relative to the threshold. Both numbers are response
  // fields; the gap between them is shown as a gap, with both sides visible.
  const p95_peak_i = band.p95.indexOf(Math.max(...band.p95));
  const p95_peak = band.p95[p95_peak_i];
  const overIdx = band.p95.map((v, i) => (v > def_c ? i : -1)).filter((i) => i >= 0);
  const crosses = overIdx.length > 0;

  const ticks: number[] = [];
  for (let v = T_MIN; v <= T_MAX; v += 10) ticks.push(v);
  const hourTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * t_max);

  return (
    <div className="bg-bg-surface overflow-y-auto h-full">
      <div className="p-3">
        {/* A band drawn beside a pour it was not computed for is worse than no band at
            all, so the moment the inputs move off the fixed scenario this says so
            rather than letting the two be read together. */}
        {!matchesDemo && (
          <p className="mb-2 rounded-lg border border-status-amber/30 bg-status-amber-dim px-2.5 py-2 text-[10px] leading-relaxed text-text-secondary">
            <span className="font-semibold text-status-amber">Not this run.</span> The band
            below was precomputed for one fixed scenario and the inputs no longer match it. The
            nominal line is the run on screen; the envelope is not its envelope. Reset the
            inputs to compare them.
          </p>
        )}
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <SectionLabel>core_temp_c ensemble</SectionLabel>
          <span className="text-[10px] text-text-muted tabular-nums">
            n_samples {e.n_samples} · seed {e.seed} · dx {e.dx_m} m
          </span>
          <span className="text-[10px] text-text-muted">
            precomputed for ONE fixed scenario · built {demo.built_at}
          </span>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 250 }} role="img" aria-label="Core temperature percentile band against the DEF threshold">
          <line x1={ML} y1={MT} x2={ML} y2={H - MB} stroke="rgba(240,246,252,0.25)" />
          {ticks.map((v) => (
            <g key={v}>
              <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} stroke="rgba(240,246,252,0.07)" />
              <text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="rgba(240,246,252,0.45)">{v}</text>
            </g>
          ))}
          <text x={ML - 6} y={MT - 2} textAnchor="end" fontSize="8" fill="rgba(240,246,252,0.35)">°C</text>

          <line x1={ML} y1={H - MB} x2={W - MR} y2={H - MB} stroke="rgba(240,246,252,0.25)" />
          {hourTicks.map((h, k) => (
            <text key={k} x={ML + (t_max > 0 ? h / t_max : 0) * (W - ML - MR)} y={H - MB + 15} textAnchor="middle" fontSize="9" fill="rgba(240,246,252,0.45)">
              {timesMatch ? `${h.toFixed(0)}h` : `${h.toFixed(0)}`}
            </text>
          ))}

          <path d={area(band.p95, band.p05)} fill="#5d82e9" opacity={0.16} />
          <path d={area(band.p75, band.p25)} fill="#5d82e9" opacity={0.24} />
          <path d={line(band.p50)} fill="none" stroke="#5d82e9" strokeWidth="2" />
          <path d={line(band.p95)} fill="none" stroke="#5d82e9" strokeWidth="1" opacity={0.7} />
          <path d={line(band.p05)} fill="none" stroke="#5d82e9" strokeWidth="1" opacity={0.7} />

          {/* the threshold, drawn ACROSS the band rather than beside it */}
          <line x1={ML} y1={y(def_c)} x2={W - MR} y2={y(def_c)} stroke="#e5484d" strokeWidth="1.5" strokeDasharray="6 4" />
          <text x={W - MR - 4} y={y(def_c) - 5} textAnchor="end" fontSize="9" fill="#e5484d" className="tabular-nums">
            DEF {def_c} °C · USBR DSO-12-02
          </text>

          {/* the part of the upper edge that is above it */}
          {crosses && (
            <path
              d={area(
                band.p95.map((v, i) => (overIdx.includes(i) ? v : def_c)),
                band.p95.map(() => def_c),
              )}
              fill="#e5484d"
              opacity={0.22}
            />
          )}

          {/* the nominal run, for the comparison the panel exists to make */}
          <line x1={ML} y1={y(nominal.peak_core_temp_c)} x2={W - MR} y2={y(nominal.peak_core_temp_c)} stroke="#da720d" strokeWidth="1" strokeDasharray="2 3" />
          <text x={ML + 4} y={y(nominal.peak_core_temp_c) - 4} fontSize="9" fill="#da720d" className="tabular-nums">
            nominal peak_core_temp_c {nominal.peak_core_temp_c.toFixed(2)} °C
          </text>
        </svg>

        {/* THE point of this panel */}
        <div className="mt-2 rounded-lg border border-border-default bg-elevate-1 p-2.5">
          <div className="text-xs font-semibold text-text-primary">
            The nominal flag and the band edge disagree, and both are right
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] tabular-nums">
            <span className="text-text-muted">nominal peak_core_temp_c</span>
            <span className="text-text-primary">{nominal.peak_core_temp_c.toFixed(2)} °C</span>
            <span className="text-text-muted">nominal max_core_temp_anywhere_c</span>
            <span className="text-text-primary">{nominal.max_core_temp_anywhere_c.toFixed(2)} °C</span>
            <span className="text-text-muted">nominal breaches.def_risk</span>
            <span className={nominal.breaches.def_risk ? "text-status-amber" : "text-text-primary"}>
              {String(nominal.breaches.def_risk)}
            </span>
            <span className="text-text-muted">p50 peak</span>
            <span className="text-text-primary">{Math.max(...band.p50).toFixed(3)} °C</span>
            <span className="text-text-muted">p05 peak</span>
            <span className="text-text-primary">{Math.max(...band.p05).toFixed(3)} °C</span>
            <span className="text-text-muted">p95 peak</span>
            <span className="text-status-amber">{p95_peak.toFixed(3)} °C</span>
            <span className="text-text-muted">DEF threshold</span>
            <span className="text-text-primary">{def_c} °C</span>
          </div>
          {crosses ? (
            <p className="mt-2 text-[11px] text-text-secondary leading-relaxed">
              The p95 edge peaks{" "}
              <span className="text-status-amber tabular-nums">
                {(p95_peak - def_c).toFixed(3)} °C
              </span>{" "}
              above the threshold and stays above it for{" "}
              <span className="tabular-nums">{overIdx.length}</span> of {n} recorded frames
              {timesMatch && (
                <>
                  {" "}(
                  <span className="tabular-nums">
                    {t(overIdx[0]).toFixed(1)}–{t(overIdx[overIdx.length - 1]).toFixed(1)} h
                  </span>
                  )
                </>
              )}
              . The nominal case does not breach: a single deterministic run sits at{" "}
              <span className="tabular-nums">{nominal.peak_core_temp_c.toFixed(2)} °C</span>. What
              crosses is the upper tail — part of the sampled parameter space, not the
              nominal pour. The flag reports the nominal case, the band the spread. Reading
              only one is how a run that could breach gets a green light.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-text-secondary leading-relaxed">
              No part of the band crosses the threshold in this artifact.
            </p>
          )}
          <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
            Band solved at dx {e.dx_m} m, nominal live at dx{" "} {demo.scenario.element.dx_m}
            m. Not the same discretisation — the note below quantifies the difference.
          </p>
        </div>

        {/* the artifact's own words about how far its edges can be trusted */}
        <div className="mt-2 p-2.5 rounded-lg border border-border-default bg-elevate-1">
          <SectionLabel className="mb-1.5">
            Band-edge noise — the artifact&apos;s NOTE, verbatim
          </SectionLabel>
          <p className="text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap font-mono">
            {demo.note}
          </p>
          <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
            Word for word, not summarised. The measured seed-to-seed figures live in this string
            and have been revised before; retyping one from elsewhere would be a different claim
            wearing the artifact&apos;s authority.
          </p>
        </div>

        {/* what was sampled, and what the spread is conditional on */}
        <div className="mt-2 p-2.5 rounded-lg border border-border-default bg-elevate-1 text-[10px]">
          <div className="font-semibold uppercase tracking-[0.08em] text-text-secondary mb-1.5">
            Provenance
          </div>
          <Row label="sampler" value={demo.sampler} />
          <Row label="dt_s" value={demo.dt_s.toFixed(1)} />
          <Row label="strip_time_h_p95" value={e.strip_time_h_p95 === null ? "not reached" : e.strip_time_h_p95.toFixed(2)} />
          <Row label="sampled_parameters" value={demo.sampled_parameters.join(", ")} />
          <div className="mt-1.5 pt-1.5 border-t border-hairline">
            <Row
              label="forecast_error"
              value={e.forecast_error.provisional ? "PROVISIONAL — not measured skill" : "measured"}
              warn={e.forecast_error.provisional}
            />
            <p className="mt-1 text-text-muted leading-relaxed">{e.forecast_error.source}</p>
          </div>
          {!timesMatch && (
            <p className="mt-1.5 text-status-amber leading-relaxed">
              Band has {n} frames, nominal run has {nominal.times_h.length}. The x axis is
              frame index, not hours — different cadences.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="text-text-muted shrink-0 w-[130px]">{label}</span>
      <span className={`${warn ? "text-status-amber" : "text-text-secondary"} break-all`}>{value}</span>
    </div>
  );
}
