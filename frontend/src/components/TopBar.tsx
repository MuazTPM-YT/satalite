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
  Crosshair,
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
import LocationChip, { type ActiveLocation } from "@/components/LocationChip";
import { Segmented, ToolbarDivider, ToolbarToggle, cx, type Icon } from "@/components/ui";
import { useTooltip } from "@/components/Tooltip";
import { Select } from "@/components/fields";
import { UNIT_OPTIONS, type LengthUnit } from "@/lib/units";
import type { AmbientResponse } from "@/lib/api";

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
  /** where the pour is, and whether that day cost anything */
  location: ActiveLocation | null;
  durationHours: number;
  onLocationApply: (response: AmbientResponse, label: string) => void;
}

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: Icon }[] = [
  { id: "2d", label: "2D View", icon: Grid2x2 },
  { id: "3d", label: "3D View", icon: Box },
];

// launcher icon, accessible name, and what the palette actually answers
const PANELS: { id: PanelId; icon: Icon; label: string; hint: string }[] = [
  {
    id: "element",
    icon: Settings2,
    label: "Element & mix inputs",
    hint: "Section, dimensions, mix design and cure window. Every control here reaches the solver.",
  },
  {
    id: "probe",
    icon: Crosshair,
    label: "Probe",
    hint: "The point you last clicked in either viewer: its temperature, and its distances to the section's faces and corners.",
  },
  {
    id: "checks",
    icon: ListChecks,
    label: "Checks & thresholds",
    hint: "Each measured quantity beside the limit it was tested against, and the standard the limit comes from.",
  },
  {
    id: "pour",
    icon: CalendarClock,
    label: "Pour window",
    hint: "The same element solved at every candidate start hour the ambient series has room for. One full solve each, so the sweep runs only while this is open.",
  },
  {
    id: "ensemble",
    icon: Waves,
    label: "Ensemble band",
    hint: "Precomputed p05/p95 bands over the parameters we genuinely do not know. One fixed scenario.",
  },
  {
    id: "season",
    icon: CalendarRange,
    label: "Season replay",
    hint: "Precomputed exposure across a sampled season, by placement hour.",
  },
  {
    id: "validation",
    icon: BadgeCheck,
    label: "Validation report",
    hint: "How the solver did against the measured USBR DSO-12-02 cases.",
  },
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
  location,
  durationHours,
  onLocationApply,
}: TopBarProps) {
  const solveTip = useTooltip(
    solving ? (
      "A solve is in flight."
    ) : stale ? (
      <>
        <span className="block font-medium">Solve with the current inputs</span>
        <span className="mt-0.5 block text-text-secondary">
          The boxes have moved off the run on screen. The drawing keeps showing the last
          real answer until a new one lands.
        </span>
      </>
    ) : (
      <>
        <span className="block font-medium">Re-run the solve</span>
        <span className="mt-0.5 block text-text-secondary">
          The inputs already match the run on screen, so this returns the same answer.
        </span>
      </>
    ),
  );

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-default bg-bg-surface px-4">
      {/* left: mark + wordmark */}
      <div className="z-10 flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-blue-dim">
          <Box className="h-4 w-4 text-accent-blue" strokeWidth={2} />
        </span>
        <span className="truncate text-[15px] font-semibold tracking-tight text-text-primary">
          SatAlite
          <span className="hidden font-normal text-text-muted sm:inline"> Studio</span>
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
        {/* Scrolls rather than disappearing. It used to be `hidden md:flex`, which on a
            narrow window left no view switcher, no palette launchers and no way back to
            a palette once it was closed - the studio simply stopped having controls. */}
        <div className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-xl bg-elevate-1 p-1 ring-1 ring-inset ring-hairline">
          {/* the switcher moves in here below lg, where the centred copy is hidden */}
          <div className="shrink-0 lg:hidden">
            <Segmented
              value={viewMode}
              options={VIEW_OPTIONS}
              onChange={onViewModeChange}
              label="Viewer mode"
              size="sm"
            />
          </div>
          <div className="shrink-0 lg:hidden">
            <ToolbarDivider />
          </div>

          {PANELS.map((p) => (
            <ToolbarToggle
              key={p.id}
              icon={p.icon}
              label={p.label}
              hint={p.hint}
              active={openPanels[p.id]}
              onClick={() => onTogglePanel(p.id)}
            />
          ))}

          <ToolbarDivider />

          {/* length units. Dimensions only - °C never converts. */}
          <div className="flex shrink-0 items-center gap-1.5 pl-1 pr-0.5">
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
          {...solveTip.trigger}
          type="button"
          onClick={() => {
            solveTip.hide();
            onSolve();
          }}
          disabled={solving}
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
        {solveTip.node}

        {/* A site label used to live here as a hardcoded caption. It is a real control
            now: /api/ambient echoes the latitude it handed to build_ambient, so the chip
            names a location the solver actually used, and its dot says whether that day
            came off disk or cost credits. */}
        <LocationChip
          active={location}
          durationHours={durationHours}
          onApply={onLocationApply}
        />
        <HealthProbe />
      </div>
    </header>
  );
}
