// checks panel. DEF risk, cracking, placement, evaporation + strip-ready summary
export default function ChecksPanel() {
  return (
    <aside className="w-[280px] shrink-0 bg-bg-surface border-l border-border-default overflow-y-auto">
      <div className="p-3">
        {/* header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted text-xs">⊞</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
              Checks
            </span>
          </div>
          <span className="text-[10px] text-text-muted">ACI 306 / 305</span>
        </div>

        {/* check cards */}
        <div className="flex flex-col gap-2">
          <CheckCard
            status="pass"
            title="DEF Risk"
            subtitle="peak core"
            value={58}
            limit={70}
            unit="°C"
            progress={58 / 70}
          />
          <CheckCard
            status="pass"
            title="Cracking"
            subtitle="max ΔT core-surf"
            value={14}
            limit={20}
            unit="°C"
            progress={14 / 20}
          />
          <CheckCard
            status="pass"
            title="Placement"
            subtitle="concrete at discharge"
            value={29}
            limit={32}
            unit="°C"
            progress={29 / 32}
          />
          <CheckCard
            status="warn"
            title="Evaporation"
            subtitle="rate"
            value={0.23}
            limit={0.20}
            unit="kg/m²/h"
            progress={0.23 / 0.20}
            warning="Exceeded 0.020–19:55. Fogging or evaporation retarder required on the exposed top face."
          />
        </div>

        {/* strip-ready summary */}
        <div className="mt-4 p-3 rounded-lg bg-bg-elevated border border-border-default">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
            Strip-Ready
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            Thu 14:00
          </div>
          <div className="text-xs text-text-secondary mt-1">
            95% confidence &nbsp;&nbsp; ±3.5 h
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <span className="text-text-muted">0% f&apos;c now</span>
            <span className="text-text-muted">70% req.</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-bg-primary overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-blue transition-all"
              style={{ width: "0%" }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

// single check card
function CheckCard({
  status,
  title,
  subtitle,
  value,
  limit,
  unit,
  progress,
  warning,
}: {
  status: "pass" | "warn" | "fail";
  title: string;
  subtitle: string;
  value: number;
  limit: number;
  unit: string;
  progress: number;
  warning?: string;
}) {
  const colors = {
    pass: {
      icon: "✓",
      border: "border-l-status-green",
      iconColor: "text-status-green",
      barBg: "bg-status-green-dim",
      barFill: "bg-status-green",
    },
    warn: {
      icon: "⚠",
      border: "border-l-status-amber",
      iconColor: "text-status-amber",
      barBg: "bg-status-amber-dim",
      barFill: "bg-status-amber",
    },
    fail: {
      icon: "✗",
      border: "border-l-status-red",
      iconColor: "text-status-red",
      barBg: "bg-status-red-dim",
      barFill: "bg-status-red",
    },
  };

  const c = colors[status];
  const clamped = Math.min(progress, 1);

  return (
    <div
      className={`p-2.5 rounded-lg bg-bg-elevated border-l-[3px] ${c.border}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm ${c.iconColor}`}>{c.icon}</span>
          <div>
            <div className="text-xs font-semibold text-text-primary uppercase">
              {title}
            </div>
            <div className="text-[10px] text-text-muted">{subtitle}</div>
          </div>
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold text-text-primary">
            {value}
          </span>
          <span className="text-xs text-text-muted">
            {" "}/ {limit} {unit}
          </span>
        </div>
      </div>

      {/* progress bar */}
      <div className={`mt-2 h-1.5 rounded-full ${c.barBg} overflow-hidden`}>
        <div
          className={`h-full rounded-full ${c.barFill} transition-all`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>

      {/* warning text */}
      {warning && (
        <p className="mt-2 text-[10px] text-status-amber leading-tight">
          {warning}
        </p>
      )}
    </div>
  );
}
