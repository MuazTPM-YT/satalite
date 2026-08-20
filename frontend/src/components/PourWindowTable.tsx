// pour window comparison table. 3 candidate start times
export default function PourWindowTable() {
  return (
    <div className="border-t border-border-default bg-bg-surface">
      <div className="flex items-start">
        {/* table area */}
        <div className="flex-1 p-3">
          {/* header */}
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-text-muted text-xs">⊞</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
              Pour Window
            </span>
            <span className="text-[10px] text-text-muted ml-1">
              · 3 candidate start times · 2026-08-22
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
              {/* row 1: 04:00 SELECTED */}
              <tr className="border border-accent-blue rounded bg-accent-blue-dim">
                <td className="py-1.5 pr-4">
                  <span className="font-semibold text-text-primary">04:00</span>
                  <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-accent-blue text-white font-medium uppercase">
                    Selected
                  </span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">58 °C</span>
                  <span className="ml-1 text-status-green">✓</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">14 °C</span>
                  <span className="ml-1 text-status-green">✓</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">0.11</span>
                  <span className="ml-1 text-status-green">✓</span>
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary">62 h</span>
                    <div className="w-20 h-1.5 rounded-full bg-bg-primary overflow-hidden">
                      <div className="h-full rounded-full bg-accent-blue" style={{ width: "86%" }} />
                    </div>
                  </div>
                </td>
              </tr>

              {/* row 2: 09:00 */}
              <tr>
                <td className="py-1.5 pr-4">
                  <span className="text-text-secondary">09:00</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">64 °C</span>
                  <span className="ml-1 text-status-green">✓</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">19 °C</span>
                  <span className="ml-1 text-status-amber">⚠</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">0.18</span>
                  <span className="ml-1 text-status-green">✓</span>
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary">57 h</span>
                    <div className="w-20 h-1.5 rounded-full bg-bg-primary overflow-hidden">
                      <div className="h-full rounded-full bg-accent-blue" style={{ width: "79%" }} />
                    </div>
                  </div>
                </td>
              </tr>

              {/* row 3: 14:00 FAIL */}
              <tr className="border border-status-red rounded bg-status-red-dim">
                <td className="py-1.5 pr-4">
                  <span className="font-semibold text-text-primary">14:00</span>
                  <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-status-red text-white font-medium uppercase">
                    3 Checks Fail
                  </span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">71 °C</span>
                  <span className="ml-1 text-status-red">✗</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">24 °C</span>
                  <span className="ml-1 text-status-red">✗</span>
                </td>
                <td className="py-1.5 pr-4">
                  <span className="text-text-primary">0.31</span>
                  <span className="ml-1 text-status-red">✗</span>
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary">51 h</span>
                    <span className="px-1.5 py-0.5 text-[9px] rounded bg-status-red text-white font-medium uppercase">
                      Fastest
                    </span>
                    <div className="w-20 h-1.5 rounded-full bg-bg-primary overflow-hidden">
                      <div className="h-full rounded-full bg-status-red" style={{ width: "100%" }} />
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* footnote */}
          <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
            14:00 strips 11 h earlier than 04:00 but exceeds DEF, cracking and
            evaporation limits — the time saved is bought against three separate
            criteria, not one score.
          </p>
        </div>

        {/* right summary card */}
        <div className="w-[200px] shrink-0 p-3 border-l border-border-default">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-1">
            Strip-Ready
          </div>
          <div className="text-xl font-semibold text-text-primary">
            Thu 14:00
          </div>
          <div className="text-[11px] text-text-secondary mt-0.5">
            95% confidence &nbsp;&nbsp; ±3.5 h
          </div>
          <div className="mt-3 flex items-center justify-between text-[10px] text-text-muted">
            <span>0% f&apos;c now</span>
            <span>70% req.</span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-bg-primary overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-blue"
              style={{ width: "0%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
