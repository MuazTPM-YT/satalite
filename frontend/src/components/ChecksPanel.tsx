// checks panel. Every number here is a field of the response, shown next to the
// threshold it was tested against and the quantity that tripped it.
//
// This panel ANNOTATES, it does not adjudicate. It never says a pour will crack or is
// safe to strip - it states the measured value, the limit, and where the limit comes
// from, and leaves the call to the engineer reading it.
"use client";

import type { SimulationRequest, SimulationResult, TrippedBy } from "@/lib/api";

interface ChecksPanelProps {
  sim: SimulationResult;
  // the request that was solved. placement_temp_c is an input, not a result, so the
  // placement flag has no explanation without it.
  request: SimulationRequest;
}

// which quantity crossed, in words. "none" is not a verdict, it is an observation.
const TRIPPED_LABEL: Record<TrippedBy, string> = {
  probe: "probe only",
  max_anywhere: "hottest point only",
  both: "probe and hottest point",
  none: "neither",
};

export default function ChecksPanel({ sim, request }: ChecksPanelProps) {
  const b = sim.breaches;
  const placement_temp_c = request.element.placement_temp_c;

  return (
    <aside className="w-[280px] shrink-0 bg-bg-surface overflow-y-auto">
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted text-xs">⊞</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
              Checks
            </span>
          </div>
          <span className="text-[10px] text-text-muted">measured vs limit</span>
        </div>

        <div className="flex flex-col gap-2">
          <Check
            title="DEF"
            over={b.def_risk}
            limit={`${b.def_threshold_c} °C`}
            source="USBR DSO-12-02 · 155 °F DESIGN max, deliberately below the 158 °F ettringite threshold"
            trippedBy={b.def_tripped_by}
            rows={[
              ["probe", `${sim.peak_core_temp_c.toFixed(2)} °C`, "peak_core_temp_c"],
              ["hottest point", `${sim.max_core_temp_anywhere_c.toFixed(2)} °C`, "max_core_temp_anywhere_c"],
            ]}
          />

          <Check
            title="Cracking differential"
            over={b.cracking}
            limit={`${b.cracking_limit_c} °C`}
            source="ACI 207 (35 °F)"
            trippedBy={b.cracking_tripped_by}
            rows={[
              ["probe", `${sim.max_core_surface_diff_c.toFixed(2)} °C`, "max_core_surface_diff_c"],
              ["hottest point", `${sim.max_anywhere_surface_diff_c.toFixed(2)} °C`, "max_anywhere_surface_diff_c"],
            ]}
          />

          <Check
            title="Evaporation"
            over={b.evaporation}
            limit={`${b.evaporation_limit_kg_m2_h.toFixed(1)} kg/m²/h`}
            source="ACI 305R (0.2 lb/ft²/h)"
            rows={[["peak", `${sim.peak_evaporation_kg_m2_h.toFixed(3)} kg/m²/h`, "peak_evaporation_kg_m2_h"]]}
          />

          <Check
            title="Placement"
            over={b.placement}
            limit={`${b.placement_limit_c} °C`}
            source="ACI 305, often project-specific · PROVISIONAL"
            rows={
              placement_temp_c === undefined
                ? []
                : [["at discharge", `${placement_temp_c.toFixed(2)} °C`, "element.placement_temp_c"]]
            }
          />
        </div>

        {/* strip time. null means the strength fraction was never reached in this run,
            which is a fact about the run, not a missing number. */}
        <div className="mt-4 p-3 rounded-lg bg-bg-elevated border border-border-default">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
            strip_time_h
          </div>
          {sim.strip_time_h === null ? (
            <p className="text-xs text-text-secondary leading-relaxed">
              Not reached inside the {sim.times_h[sim.times_h.length - 1]?.toFixed(0)} h solved.
              The response returned null; nothing is being estimated in its place.
            </p>
          ) : (
            <>
              <div className="text-2xl font-semibold text-text-primary tabular-nums">
                {sim.strip_time_h.toFixed(1)} h
              </div>
              <p className="mt-1 text-[10px] text-text-muted leading-relaxed">
                Strength calibration is PROVISIONAL. Maturity integrated at t_ref{" "}
                {sim.t_ref_c.toFixed(1)} °C, which must match that calibration.
              </p>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

// one threshold, its measured quantities, and which of them crossed
function Check({
  title,
  over,
  limit,
  source,
  trippedBy,
  rows,
}: {
  title: string;
  over: boolean;
  limit: string;
  source: string;
  trippedBy?: TrippedBy;
  rows: [string, string, string][];
}) {
  return (
    <div
      className={`p-2.5 rounded-lg bg-bg-elevated border-l-[3px] ${
        over ? "border-l-status-amber" : "border-l-border-strong"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold text-text-primary">{title}</div>
        <div className="text-[10px] text-text-muted whitespace-nowrap tabular-nums">
          limit {limit}
        </div>
      </div>

      {rows.map(([label, value, field]) => (
        <div key={field} className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[10px] text-text-muted">{label}</span>
          <span className="text-xs text-text-primary font-medium tabular-nums">{value}</span>
        </div>
      ))}

      <div className="mt-2 text-[10px] leading-tight">
        <span className={over ? "text-status-amber" : "text-text-secondary"}>
          {over ? "over the limit" : "under the limit"}
        </span>
        {trippedBy !== undefined && (
          <span className="text-text-muted"> · crossed by {TRIPPED_LABEL[trippedBy]}</span>
        )}
      </div>
      <div className="mt-1 text-[9px] text-text-muted leading-tight">{source}</div>
    </div>
  );
}
