// checks panel. reads values from sim.flags, not hardcoded
"use client";

import type { FlagsData } from "@/lib/mockThermalField";

interface ChecksPanelProps {
  flags: FlagsData;
}

export default function ChecksPanel({ flags }: ChecksPanelProps) {
  const { def_risk, cracking, placement, evaporation, strip_ready } = flags;

  return (
    <aside className="w-[280px] shrink-0 bg-bg-surface overflow-y-auto">
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

        {/* check cards — driven by sim.flags */}
        <div className="flex flex-col gap-2">
          <CheckCard
            status={def_risk.status}
            title={def_risk.label}
            subtitle={def_risk.subtitle}
            value={def_risk.value}
            limit={def_risk.limit}
            unit={def_risk.unit}
            progress={def_risk.value / def_risk.limit}
          />
          <CheckCard
            status={cracking.status}
            title={cracking.label}
            subtitle={cracking.subtitle}
            value={cracking.value}
            limit={cracking.limit}
            unit={cracking.unit}
            progress={cracking.value / cracking.limit}
          />
          <CheckCard
            status={placement.status}
            title={placement.label}
            subtitle={placement.subtitle}
            value={placement.value}
            limit={placement.limit}
            unit={placement.unit}
            progress={placement.value / placement.limit}
          />
          <CheckCard
            status={evaporation.status}
            title={evaporation.label}
            subtitle={evaporation.subtitle}
            value={evaporation.value}
            limit={evaporation.limit}
            unit={evaporation.unit}
            progress={evaporation.value / evaporation.limit}
            warning={evaporation.warning}
          />
        </div>

        {/* strip-ready summary — driven by sim.flags.strip_ready */}
        <div className="mt-4 p-3 rounded-lg bg-bg-elevated border border-border-default">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
            Strip-Ready
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {strip_ready.ready_time}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {strip_ready.confidence_pct}% confidence &nbsp;&nbsp; ±{strip_ready.delta_h} h
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <span className="text-text-muted">{strip_ready.current_strength_pct}% f&apos;c now</span>
            <span className="text-text-muted">{strip_ready.required_strength_pct}% req.</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-bg-primary overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-blue transition-all"
              style={{ width: `${(strip_ready.current_strength_pct / strip_ready.required_strength_pct) * 100}%` }}
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
