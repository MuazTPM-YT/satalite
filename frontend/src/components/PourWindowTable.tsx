// pour window candidates, straight from /api/pour-windows.
//
// Columns are the response's own quantities. Where the backend reports both a probe and
// a hottest-point figure, both are shown - the probe alone is the less conservative one.
"use client";

import type { PourWindowCandidate } from "@/lib/api";

interface PourWindowTableProps {
  candidates: PourWindowCandidate[];
  best_offset_h: number;
}

// a cell that carries a limit, marked when the response says it was crossed
function Cell({ value, over }: { value: string; over: boolean }) {
  return (
    <span className={`tabular-nums ${over ? "text-status-amber" : "text-text-primary"}`}>
      {value}
      {over && <span className="ml-1 text-status-amber">▲</span>}
    </span>
  );
}

import { Flag, SectionLabel, cx } from "@/components/ui";

export default function PourWindowTable({ candidates, best_offset_h }: PourWindowTableProps) {
  return (
    <div className="h-full w-full overflow-y-auto bg-bg-surface">
      <div className="p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <SectionLabel>Pour Window</SectionLabel>
          <span className="text-[10px] text-text-muted ml-1">
            · {candidates.length} candidate offsets · fewest breaches wins, ties on the cooler core
          </span>
        </div>

        <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[760px] text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-[0.06em] text-text-muted">
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-medium">offset_h</th>
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-medium">placement_temp_c</th>
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-medium">peak_core_temp_c</th>
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-medium">max_core_temp_anywhere_c</th>
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-medium">ΔT probe / anywhere</th>
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-medium">peak_evaporation_kg_m2_h</th>
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-medium">strip_time_h</th>
              <th className="whitespace-nowrap py-1.5 text-left font-mono font-medium">n_breaches</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const picked = c.offset_h === best_offset_h;
              return (
                <tr
                  key={c.offset_h}
                  className={cx("border-t border-hairline", picked ? "bg-accent-blue-dim" : "hover:bg-elevate-1")}
                >
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono tabular-nums text-text-primary">
                    {c.offset_h.toFixed(1)}
                    {picked && <span className="ml-1.5"><Flag tone="muted">pick</Flag></span>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono">
                    <Cell value={c.placement_temp_c.toFixed(1)} over={c.breaches.placement} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono">
                    <Cell value={c.peak_core_temp_c.toFixed(1)} over={c.breaches.def_tripped_by === "probe" || c.breaches.def_tripped_by === "both"} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono">
                    <Cell value={c.max_core_temp_anywhere_c.toFixed(1)} over={c.breaches.def_tripped_by === "max_anywhere" || c.breaches.def_tripped_by === "both"} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono tabular-nums text-text-primary">
                    <Cell value={c.max_core_surface_diff_c.toFixed(1)} over={c.breaches.cracking_tripped_by === "probe" || c.breaches.cracking_tripped_by === "both"} />
                    <span className="text-text-muted"> / </span>
                    <Cell value={c.max_anywhere_surface_diff_c.toFixed(1)} over={c.breaches.cracking_tripped_by === "max_anywhere" || c.breaches.cracking_tripped_by === "both"} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono">
                    <Cell value={c.peak_evaporation_kg_m2_h.toFixed(3)} over={c.breaches.evaporation} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono tabular-nums text-text-primary">
                    {c.strip_time_h === null ? (
                      <span className="text-text-muted">not reached</span>
                    ) : (
                      c.strip_time_h.toFixed(1)
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 font-mono tabular-nums text-text-primary">{c.n_breaches}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
          ▲ marks a quantity the response reports as over its limit. Limits and the
          quantity that crossed them are in the Checks palette.
        </p>
      </div>
    </div>
  );
}
