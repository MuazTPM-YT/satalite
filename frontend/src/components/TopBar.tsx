// top bar for studio. logo, view toggle, panel launchers, location
"use client";

import type { PanelId } from "@/components/PanelId";
import { UNIT_OPTIONS, type LengthUnit } from "@/lib/units";

export type ViewMode = "2d" | "3d";

interface TopBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  openPanels: Record<PanelId, boolean>;
  onTogglePanel: (id: PanelId) => void;
  units: LengthUnit;
  onUnitsChange: (u: LengthUnit) => void;
}

// active tab pill style
function tabClass(active: boolean): string {
  return active
    ? "px-4 py-1 text-xs font-medium rounded-sm bg-bg-elevated text-text-primary"
    : "px-4 py-1 text-xs font-medium rounded-sm text-text-secondary hover:text-text-primary transition-colors";
}

// panel launcher icon style — active when its palette is open
function panelIconClass(active: boolean): string {
  return active
    ? "w-7 h-7 flex items-center justify-center rounded-sm bg-bg-elevated text-text-primary text-sm"
    : "w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary text-sm hover:text-text-primary hover:bg-bg-elevated transition-colors";
}

// launcher glyph + tooltip per panel
const PANELS: { id: PanelId; icon: string; label: string }[] = [
  { id: "element", icon: "◧", label: "Element & Mix Inputs" },
  { id: "checks", icon: "✓", label: "Checks & Strip-Ready" },
  { id: "pour", icon: "⊞", label: "Pour Window" },
];

export default function TopBar({
  viewMode,
  onViewModeChange,
  openPanels,
  onTogglePanel,
  units,
  onUnitsChange,
}: TopBarProps) {
  return (
    <header className="flex items-center justify-between h-11 px-4 bg-bg-surface border-b border-border-default shrink-0">
      {/* left: logo */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-text-primary">
          ⚙ SatAlite
        </span>
        <span className="text-sm font-light text-text-secondary">Studio</span>
      </div>

      {/* center: view toggle + panel launchers */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 bg-bg-primary rounded-sm p-0.5">
          <button
            id="toggle-2d"
            aria-pressed={viewMode === "2d"}
            className={tabClass(viewMode === "2d")}
            onClick={() => onViewModeChange("2d")}
          >
            2D View
          </button>
          <button
            id="toggle-3d"
            aria-pressed={viewMode === "3d"}
            className={tabClass(viewMode === "3d")}
            onClick={() => onViewModeChange("3d")}
          >
            3D View
          </button>
        </div>

        <div className="w-px h-4 bg-border-default" />

        <div className="flex items-center gap-1">
          {PANELS.map((p) => (
            <button
              key={p.id}
              title={p.label}
              aria-label={p.label}
              aria-pressed={openPanels[p.id]}
              className={panelIconClass(openPanels[p.id])}
              onClick={() => onTogglePanel(p.id)}
            >
              {p.icon}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border-default" />

        {/* length unit selector — dimensions only, °C never converts */}
        <select
          id="unit-select"
          title="Length units"
          aria-label="Length units"
          value={units}
          onChange={(e) => onUnitsChange(e.target.value as LengthUnit)}
          className="text-xs text-text-secondary bg-bg-primary border border-border-default rounded-sm px-1.5 py-1"
        >
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      {/* right: location */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-secondary">
          📍 Phoenix, AZ · Aug 22
        </span>
      </div>
    </header>
  );
}
