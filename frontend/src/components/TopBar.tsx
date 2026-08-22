// top bar for studio. logo, view toggle, location, ask button
"use client";

export type ViewMode = "2d" | "3d";

interface TopBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

// active tab pill style
function tabClass(active: boolean): string {
  return active
    ? "px-4 py-1 text-xs font-medium rounded-md bg-bg-elevated text-text-primary"
    : "px-4 py-1 text-xs font-medium rounded-md text-text-secondary hover:text-text-primary transition-colors";
}

export default function TopBar({ viewMode, onViewModeChange }: TopBarProps) {
  return (
    <header className="flex items-center justify-between h-11 px-4 bg-bg-surface border-b border-border-default shrink-0">
      {/* left: logo */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-text-primary">
          ⚙ SatAlite
        </span>
        <span className="text-sm font-light text-text-secondary">Studio</span>
      </div>

      {/* center: view toggle */}
      <div className="flex items-center gap-0.5 bg-bg-primary rounded-lg p-0.5">
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

      {/* right: location + ask */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-secondary">
          📍 Phoenix, AZ · Aug 22
        </span>
        <span className="text-text-muted">·</span>
        <button
          id="btn-ask"
          className="px-3 py-1 text-xs font-medium rounded-md border border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          disabled
        >
          + Ask
        </button>
      </div>
    </header>
  );
}
