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

export default function PourWindowTable({ candidates, best_offset_h }: PourWindowTableProps) {
  return (
    <div className="bg-bg-surface">
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-text-muted text-xs">⊞</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            Pour Window
          </span>
          <span className="text-[10px] text-text-muted ml-1">
            · {candidates.length} candidate offsets · fewest breaches wins, ties on the cooler core
          </span>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-text-muted">
              <th className="text-left py-1 pr-3 font-medium">offset_h</th>
              <th className="text-left py-1 pr-3 font-medium">placement_temp_c</th>
              <th className="text-left py-1 pr-3 font-medium">peak_core_temp_c</th>
              <th className="text-left py-1 pr-3 font-medium">max_core_temp_anywhere_c</th>
              <th className="text-left py-1 pr-3 font-medium">ΔT probe / anywhere</th>
              <th className="text-left py-1 pr-3 font-medium">peak_evaporation_kg_m2_h</th>
              <th className="text-left py-1 pr-3 font-medium">strip_time_h</th>
              <th className="text-left py-1 font-medium">n_breaches</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const picked = c.offset_h === best_offset_h;
              return (
                <tr
                  key={c.offset_h}
                  className={`border-t border-border-default ${picked ? "bg-accent-blue-dim" : ""}`}
                >
                  <td className="py-1.5 pr-3 tabular-nums text-text-primary">
                    {c.offset_h.toFixed(1)}
                    {picked && <span className="ml-1 text-[9px] text-accent-blue">PICK</span>}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Cell value={c.placement_temp_c.toFixed(1)} over={c.breaches.placement} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <Cell value={c.peak_core_temp_c.toFixed(1)} over={c.breaches.def_tripped_by === "probe" || c.breaches.def_tripped_by === "both"} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <Cell value={c.max_core_temp_anywhere_c.toFixed(1)} over={c.breaches.def_tripped_by === "max_anywhere" || c.breaches.def_tripped_by === "both"} />
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-text-primary">
                    <Cell value={c.max_core_surface_diff_c.toFixed(1)} over={c.breaches.cracking_tripped_by === "probe" || c.breaches.cracking_tripped_by === "both"} />
                    <span className="text-text-muted"> / </span>
                    <Cell value={c.max_anywhere_surface_diff_c.toFixed(1)} over={c.breaches.cracking_tripped_by === "max_anywhere" || c.breaches.cracking_tripped_by === "both"} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <Cell value={c.peak_evaporation_kg_m2_h.toFixed(3)} over={c.breaches.evaporation} />
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-text-primary">
                    {c.strip_time_h === null ? (
                      <span className="text-text-muted">not reached</span>
                    ) : (
                      c.strip_time_h.toFixed(1)
                    )}
                  </td>
                  <td className="py-1.5 tabular-nums text-text-primary">{c.n_breaches}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
          ▲ marks a quantity the response reports as over its limit. Limits and the
          quantity that crossed them are in the Checks palette.
        </p>
      </div>
    </div>
  );
}
