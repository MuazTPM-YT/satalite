// pour window table. reads rows from mock data
"use client";

import type { PourWindowCandidate } from "@/lib/mockThermalField";

interface PourWindowTableProps {
  candidates: PourWindowCandidate[];
}

// status icon for each check value
function statusIcon(pass: boolean | undefined, status?: "pass" | "warn" | "fail") {
  if (status === "warn")
    return <span className="ml-1 text-status-amber">⚠</span>;
  if (pass === false || status === "fail")
    return <span className="ml-1 text-status-red">✗</span>;
  return <span className="ml-1 text-status-green">✓</span>;
}

export default function PourWindowTable({ candidates }: PourWindowTableProps) {
  return (
    <div className="border-t border-border-default bg-bg-surface">
      <div className="p-3">
          {/* header */}
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-text-muted text-xs">⊞</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
              Pour Window
            </span>
            <span className="text-[10px] text-text-muted ml-1">
              · {candidates.length} candidate start times · 2026-08-22
            </span>
          </div>

          {/* table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-muted">
                <th className="text-left py-1 pr-4 font-medium">Start</th>
                <th className="text-left py-1 pr-4 font-medium">Peak Core</th>
                <th className="text-left py-1 pr-4 font-medium">ΔT Core-Surf</th>
                <th className="text-left py-1 pr-4 font-medium">Evaporation</th>
                <th className="text-left py-1 font-medium">Strip-Ready</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const isFail = !!c.checks_fail_badge;
                const isSelected = !!c.selected;
                const rowClass = isFail
                  ? "border border-status-red rounded bg-status-red-dim"
                  : isSelected
                  ? "border border-accent-blue rounded bg-accent-blue-dim"
                  : "";

                return (
                  <tr key={c.start_time} className={rowClass}>
                    <td className="py-1.5 pr-4">
                      <span className={`font-semibold ${isSelected || isFail ? "text-text-primary" : "text-text-secondary"}`}>
                        {c.start_time}
                      </span>
                      {isSelected && (
                        <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-accent-blue text-white font-medium uppercase">
                          Selected
                        </span>
                      )}
                      {isFail && (
                        <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-status-red text-white font-medium uppercase">
                          {c.checks_fail_badge}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className="text-text-primary">{c.peak_core_c} °C</span>
                      {statusIcon(c.peak_core_pass)}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className="text-text-primary">{c.delta_t_c} °C</span>
                      {statusIcon(undefined, c.delta_t_status)}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className="text-text-primary">{c.evaporation_rate}</span>
                      {statusIcon(c.evaporation_pass)}
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary">{c.strip_ready_h} h</span>
                        {c.fastest && (
                          <span className="px-1.5 py-0.5 text-[9px] rounded bg-status-red text-white font-medium uppercase">
                            Fastest
                          </span>
                        )}
                        <div className="w-20 h-1.5 rounded-full bg-bg-primary overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isFail ? "bg-status-red" : "bg-accent-blue"}`}
                            style={{ width: `${c.strip_ready_pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* footnote — exact text from mockup spec */}
          <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
            14:00 strips 11 h earlier than 04:00 but exceeds DEF, cracking and
            evaporation limits — the time saved is bought against three separate
            criteria, not one score.
          </p>
      </div>
    </div>
  );
}
