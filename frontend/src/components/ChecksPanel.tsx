// Checks. Every number is a field of the response, next to the threshold it was tested
// against and the quantity that tripped it.
//
// This panel ANNOTATES, it does not adjudicate. It never says a pour will crack or is
// safe to strip - it states the measured value, the limit, and where the limit comes
// from, and leaves the call to the engineer reading it.
//
// The bar is doing the work that four paragraphs of "Under the limit · crossed by
// neither" used to do badly: how close a quantity is to its limit is a ratio, and a
// ratio is read faster as a length than as a sentence.
"use client";

import type { SimulationRequest, SimulationResult, TrippedBy } from "@/lib/api";
import { Flag, SectionLabel, cx } from "@/components/ui";
import { useTooltip } from "@/components/Tooltip";

interface ChecksPanelProps {
  sim: SimulationResult;
  // the request that was solved. placement_temp_c is an input, not a result, so the
  // placement flag has no explanation without it.
  request: SimulationRequest;
}

// which quantity crossed. Said only when something actually did.
const TRIPPED_LABEL: Record<TrippedBy, string> = {
  probe: "probe",
  max_anywhere: "hottest point",
  both: "probe and hottest point",
  none: "",
};

interface Measure {
  label: string;
  value: number;
  field: string;
}

export default function ChecksPanel({ sim, request }: ChecksPanelProps) {
  const b = sim.breaches;
  const placement_temp_c = request.element.placement_temp_c;
  const nOver = [b.def_risk, b.cracking, b.evaporation, b.placement].filter(Boolean).length;

  return (
    <aside className="h-full w-full overflow-y-auto bg-bg-surface">
      <div className="p-3">
        <SectionLabel
          className="mb-2.5"
          note={nOver === 0 ? "none over" : `${nOver} of 4 over`}
        >
          Thresholds
        </SectionLabel>

        <div className="flex flex-col gap-1.5">
          <Check
            title="DEF"
            over={b.def_risk}
            limit={b.def_threshold_c}
            unit="°C"
            dp={1}
            cite="USBR DSO-12-02 · 155 °F design max"
            trippedBy={b.def_tripped_by}
            measures={[
              { label: "probe", value: sim.peak_core_temp_c, field: "peak_core_temp_c" },
              { label: "hottest", value: sim.max_core_temp_anywhere_c, field: "max_core_temp_anywhere_c" },
            ]}
            governing={1}
          />

          <Check
            title="Cracking Δ"
            over={b.cracking}
            limit={b.cracking_limit_c}
            unit="°C"
            dp={1}
            cite="ACI 207 · 35 °F core-to-surface"
            trippedBy={b.cracking_tripped_by}
            measures={[
              { label: "probe", value: sim.max_core_probe_diff_c, field: "max_core_probe_diff_c" },
              { label: "hottest", value: sim.max_anywhere_probe_diff_c, field: "max_anywhere_probe_diff_c" },
            ]}
            governing={1}
          />

          <Check
            title="Evaporation"
            over={b.evaporation}
            limit={b.evaporation_limit_kg_m2_h}
            unit="kg/m²/h"
            dp={2}
            cite="ACI 305R · 0.2 lb/ft²/h"
            measures={[
              { label: "peak", value: sim.peak_evaporation_kg_m2_h, field: "peak_evaporation_kg_m2_h" },
            ]}
            governing={0}
          />

          <Check
            title="Placement"
            over={b.placement}
            limit={b.placement_limit_c}
            unit="°C"
            dp={1}
            cite="ACI 305 · provisional, often project-specific"
            measures={
              placement_temp_c === undefined
                ? []
                : [{ label: "at discharge", value: placement_temp_c, field: "element.placement_temp_c" }]
            }
            governing={0}
          />
        </div>

        {/* strip time. null means the strength fraction was never reached in this run,
            which is a fact about the run, not a missing number. */}
        <div className="mt-2.5 rounded-lg border border-border-default bg-elevate-1 p-2.5">
          <SectionLabel className="mb-1.5" note={`t_ref ${sim.t_ref_c.toFixed(1)} °C`}>
            Strip time
          </SectionLabel>
          {sim.strip_time_h === null ? (
            <p className="text-[11px] leading-relaxed text-text-secondary">
              Not reached in the {sim.times_h[sim.times_h.length - 1]?.toFixed(0)} h solved.
              The response returned null; nothing is estimated in its place.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[26px] font-semibold leading-none tabular-nums text-text-primary">
                  {sim.strip_time_h.toFixed(1)}
                </span>
                <span className="font-mono text-[12px] text-text-muted">h</span>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
                Calibration is <span className="text-status-amber">provisional</span>. The
                reference temperature above must match it.
              </p>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

/** One measured quantity under the bar, with the response field it came from. */
function Measured({ measure, dp, unit }: { measure: Measure; dp: number; unit: string }) {
  const tip = useTooltip(
    <>
      <span className="block font-mono text-[10px] text-text-secondary">{measure.field}</span>
      <span className="mt-0.5 block font-mono tabular-nums">
        {measure.value.toFixed(dp)} {unit}
      </span>
    </>,
    "top",
  );
  return (
    <>
      <span
        {...tip.trigger}
        className="font-mono text-[10px] tabular-nums text-text-muted decoration-dotted underline-offset-2 hover:underline"
      >
        {measure.label} <span className="text-text-secondary">{measure.value.toFixed(dp)}</span>
      </span>
      {tip.node}
    </>
  );
}

/**
 * One threshold.
 *
 * `governing` names which measure the flag is really keyed on — the conservative one —
 * so the bar shows that quantity rather than whichever happens to be listed first.
 */
function Check({
  title,
  over,
  limit,
  unit,
  dp,
  cite,
  trippedBy,
  measures,
  governing,
}: {
  title: string;
  over: boolean;
  limit: number;
  unit: string;
  dp: number;
  cite: string;
  trippedBy?: TrippedBy;
  measures: Measure[];
  governing: number;
}) {
  const lead = measures[Math.min(governing, measures.length - 1)];
  // the bar's full width is 125% of the limit, so the limit tick sits at 80% and a
  // value that goes over still has somewhere to go rather than pinning at the end.
  const FULL = 1.25;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / (limit * FULL)) * 100));
  const tripped = over && trippedBy && trippedBy !== "none" ? TRIPPED_LABEL[trippedBy] : "";

  // No coloured edge strip on the card. The bar already says how close this quantity
  // is to its limit and the chip already says which side of it the value falls on; a
  // third encoding of the same bit was decoration, and a column of green and amber
  // tabs read as a status dashboard rather than as an instrument.
  return (
    <div className="rounded-lg border border-border-default bg-elevate-1 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-semibold text-text-primary">{title}</span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums">
          <span className={over ? "text-status-amber" : "text-text-primary"}>
            {lead ? lead.value.toFixed(dp) : "—"}
          </span>
          <span className="text-text-muted"> / {limit.toFixed(dp)}</span>
          <span className="ml-1 text-[9px] text-text-muted">{unit}</span>
        </span>
      </div>

      {/* measured against limit. The tick is the limit; the fill is the governing
          quantity; the hairline is the other one when there are two. */}
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-bg-primary ring-1 ring-inset ring-hairline">
        {lead && (
          <div
            className={cx("absolute inset-y-0 left-0 rounded-full", over ? "bg-status-amber" : "bg-status-green")}
            style={{ width: `${pct(lead.value)}%` }}
          />
        )}
        {measures.map((m, i) =>
          i === governing ? null : (
            <div
              key={m.field}
              aria-label={`${m.label} ${m.value.toFixed(dp)} ${unit}`}
              className="absolute inset-y-0 w-px bg-text-primary/70"
              style={{ left: `${pct(m.value)}%` }}
            />
          ),
        )}
        <div className="absolute inset-y-0 w-px bg-accent-blue" style={{ left: `${100 / FULL}%` }} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {measures.map((m) => (
          <Measured key={m.field} measure={m} dp={dp} unit={unit} />
        ))}
        <Flag tone={over ? "amber" : "green"}>{over ? "over" : "under"}</Flag>
      </div>

      <p className="mt-1 text-[9px] leading-relaxed text-text-muted">
        {tripped && <span className="text-status-amber">crossed by {tripped} · </span>}
        {cite}
      </p>
    </div>
  );
}
