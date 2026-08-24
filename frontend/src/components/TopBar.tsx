// Command bar. Mark and wordmark left, the view switcher dead-centre, and the
// panel launchers plus units grouped into one pill on the right.
//
// The switcher is absolutely positioned so it is centred on the BAR, not on
// whatever space the wordmark and the right-hand pill happen to leave - otherwise
// it drifts every time the backend URL in the health chip changes length.
"use client";

import {
  BadgeCheck,
  Box,
  CalendarClock,
  CalendarRange,
  Grid2x2,
  ListChecks,
  Loader2,
  Play,
  Ruler,
  Settings2,
  Waves,
} from "lucide-react";
import type { PanelId } from "@/components/PanelId";
import HealthProbe from "@/components/HealthProbe";
import { Segmented, ToolbarDivider, ToolbarToggle, cx, type Icon } from "@/components/ui";
import { Select } from "@/components/fields";
import { UNIT_OPTIONS, type LengthUnit } from "@/lib/units";

export type ViewMode = "2d" | "3d";

// what each abbreviation means, spelled out in the list. A two-letter option in a
// styled dropdown has room for its own name; a native <select> never did.
const UNIT_NOTE: Record<LengthUnit, string> = {
  m: "metres",
  cm: "centimetres",
  mm: "millimetres",
  in: "inches",
  ft: "feet",
};

interface TopBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  openPanels: Record<PanelId, boolean>;
  onTogglePanel: (id: PanelId) => void;
  units: LengthUnit;
  onUnitsChange: (u: LengthUnit) => void;
  /** a solve is in flight */
  solving: boolean;
  /** the inputs have moved off the run on screen */
  stale: boolean;
  onSolve: () => void;
}

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: Icon }[] = [
  { id: "2d", label: "2D View", icon: Grid2x2 },
  { id: "3d", label: "3D View", icon: Box },
];

// launcher icon + accessible name per palette
const PANELS: { id: PanelId; icon: Icon; label: string }[] = [
  { id: "element", icon: Settings2, label: "Element & mix inputs" },
  { id: "checks", icon: ListChecks, label: "Checks & thresholds" },
  { id: "pour", icon: CalendarClock, label: "Pour window" },
  { id: "ensemble", icon: Waves, label: "Ensemble band" },
  { id: "season", icon: CalendarRange, label: "Season replay" },
  { id: "validation", icon: BadgeCheck, label: "Validation report" },
];

export default function TopBar({
  viewMode,
  onViewModeChange,
  openPanels,
  onTogglePanel,
  units,
  onUnitsChange,
  solving,
  stale,
  onSolve,
}: TopBarProps) {
  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-default bg-bg-surface px-4">
      {/* left: mark + wordmark */}
      <div className="z-10 flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-blue-dim">
          <Box className="h-4 w-4 text-accent-blue" strokeWidth={2} />
        </span>
        <span className="truncate text-[15px] font-semibold tracking-tight text-text-primary">
          SatAlite
          <span className="font-normal text-text-muted"> Studio</span>
        </span>
      </div>

      {/* centre: view switcher */}
      <div className="pointer-events-auto absolute left-1/2 top-1/2 z-0 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
        <Segmented
          value={viewMode}
          options={VIEW_OPTIONS}
          onChange={onViewModeChange}
          label="Viewer mode"
        />
      </div>

      {/* right: launchers, units, backend reachability */}
      <div className="z-10 flex min-w-0 items-center gap-2">
        <div className="hidden items-center gap-0.5 rounded-xl bg-elevate-1 p-1 ring-1 ring-inset ring-hairline md:flex">
          {/* the switcher moves in here below lg, where the centred copy is hidden */}
          <div className="lg:hidden">
            <Segmented
              value={viewMode}
              options={VIEW_OPTIONS}
              onChange={onViewModeChange}
              label="Viewer mode"
              size="sm"
            />
          </div>
          <div className="lg:hidden">
            <ToolbarDivider />
          </div>

          {PANELS.map((p) => (
            <ToolbarToggle
              key={p.id}
              icon={p.icon}
              label={p.label}
              active={openPanels[p.id]}
              onClick={() => onTogglePanel(p.id)}
            />
          ))}

          <ToolbarDivider />

          {/* length units. Dimensions only - °C never converts. */}
          <div className="flex items-center gap-1.5 pl-1 pr-0.5">
            <Ruler className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
            <Select<LengthUnit>
              value={units}
              options={UNIT_OPTIONS.map((u) => ({ id: u, label: u, note: UNIT_NOTE[u] }))}
              onChange={onUnitsChange}
              label="Length units — dimensions only, °C never converts"
              className="w-[62px]"
            />
          </div>
        </div>

        {/* Solve. The one action in the app that costs seconds, so it is the one
            control that says what state it is in from anywhere on screen. */}
        <button
          type="button"
          onClick={onSolve}
          disabled={solving}
          title={stale ? "The inputs have changed since this run" : "Re-run the solve"}
          className={cx(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold",
            stale && !solving
              ? "bg-accent-blue text-bg-primary"
              : "bg-elevate-1 text-text-secondary ring-1 ring-inset ring-hairline hover:bg-elevate-2 hover:text-text-primary",
          )}
        >
          {solving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
          ) : (
            <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          <span className="hidden lg:inline">{solving ? "Solving" : stale ? "Solve" : "Re-solve"}</span>
        </button>

        {/* A site label used to live here, but no response carries a location for the
            run on screen and a hardcoded one is just a caption that happens to look
            like data. Backend reachability is the honest thing to show instead. */}
        <HealthProbe />
      </div>
    </header>
  );
}
