// The probe readout.
//
// It is a PALETTE now, launched from the command bar, not a popup anchored at the
// click. Anchored, it sat on top of the drawing it was describing — and the moment
// the distances list was expanded it covered most of the section. As a palette it
// can be parked wherever the reader wants it, stays put between clicks, and both
// viewers publish into the same one.
//
// One card for 2D and 3D on purpose: a temperature read at a point is the same answer
// whichever viewer asked, and two cards would eventually drift into showing it two
// different ways.
//
// The distances are geometry, not physics. They are measured against the SOLVED
// outline the backend returned, so "42 mm to the nearest face" is a distance to the
// concrete the solver actually ran on - not to a shape rebuilt from the input boxes.
"use client";

import type { ReactNode } from "react";
import { Ruler, Tags } from "lucide-react";
import type { ProbePick } from "@/lib/probe";
import { FACING_LABEL, type ProbeGeometry } from "@/lib/sectionMetrics";
import { fmtLen, type LengthUnit } from "@/lib/units";
import { Flag, SectionLabel, cx } from "@/components/ui";
import { useTooltip } from "@/components/Tooltip";

interface ProbeCardProps {
  pick: ProbePick | null;
  geometry: ProbeGeometry | null;
  units: LengthUnit;
  showDistances: boolean;
  onToggleDistances: () => void;
  /** the shared edge/corner label layer, drawn by both viewers */
  showLabels: boolean;
  onToggleLabels: () => void;
  footer?: ReactNode;
}

// one distance row: what it is measured to, and how far.
function Distance({
  label,
  value_m,
  units,
  note,
}: {
  label: string;
  value_m: number;
  units: LengthUnit;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-[10px] text-text-muted">
        {label}
        {note && <span className="ml-1 text-text-muted/60">{note}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary">
        {fmtLen(value_m, units)}
        <span className="ml-1 text-[9px] text-text-muted">{units}</span>
      </span>
    </div>
  );
}

/** A toggle in the card's own header strip. */
function HeaderToggle({
  icon: Icon,
  label,
  tip,
  on,
  onClick,
}: {
  icon: typeof Ruler;
  label: string;
  tip: ReactNode;
  on: boolean;
  onClick: () => void;
}) {
  const t = useTooltip(tip);
  return (
    <>
      <button
        {...t.trigger}
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={cx(
          "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium",
          on
            ? "bg-accent-blue-dim text-accent-blue"
            : "text-text-muted hover:bg-elevate-2 hover:text-text-primary",
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
        {label}
      </button>
      {t.node}
    </>
  );
}

export default function ProbeCard({
  pick,
  geometry,
  units,
  showDistances,
  onToggleDistances,
  showLabels,
  onToggleLabels,
  footer,
}: ProbeCardProps) {
  const sample = pick?.sample ?? null;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-bg-surface">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-default bg-elevate-1 px-3 py-1.5">
        <HeaderToggle
          icon={Tags}
          label="Labels"
          on={showLabels}
          onClick={onToggleLabels}
          tip="Draw the section's edge letters and corner numbers in the viewer, so a distance below can be traced to a line you can see."
        />
        <HeaderToggle
          icon={Ruler}
          label="Distances"
          on={showDistances}
          onClick={onToggleDistances}
          tip="Measure this point to every face and to the nearest edges and corners of the solved section."
        />
        {sample?.fallback && (
          <span className="ml-auto">
            <Flag tone="amber">nearest cell</Flag>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 p-3">
        {sample ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[26px] font-semibold leading-none tabular-nums text-text-primary">
                {sample.temp_c.toFixed(2)}
              </span>
              <span className="font-mono text-[12px] text-text-muted">°C</span>
            </div>
            <p className="mt-1.5 font-mono text-[10px] tabular-nums text-text-muted">
              [{sample.xy_m[0].toFixed(3)}, {sample.xy_m[1].toFixed(3)}] m in the section
              {pick && (
                <span className="ml-1.5 text-text-muted/70">
                  · {pick.source === "3d" ? "3D" : (pick.view ?? "2D")}
                </span>
              )}
            </p>
            {sample.fallback && (
              <p className="mt-1.5 text-[10px] leading-snug text-status-amber">
                The 2×2 straddled a hole or the outside — this is the nearest solid cell.
              </p>
            )}

            {showDistances && geometry ? (
              <div className="mt-2.5 flex flex-col gap-1 rounded-lg border border-border-default bg-bg-primary/60 p-2.5">
                <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1">
                  <SectionLabel>Cover</SectionLabel>
                  <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-accent-blue">
                    {fmtLen(geometry.cover_m, units)}
                    <span className="ml-1 text-[9px] text-text-muted">{units}</span>
                  </span>
                </div>

                <span className="pt-0.5 text-[9px] uppercase tracking-[0.08em] text-text-muted">
                  To each face
                </span>
                <Distance label="Left face" value_m={geometry.bbox.left_m} units={units} />
                <Distance label="Right face" value_m={geometry.bbox.right_m} units={units} />
                <Distance label="Soffit" value_m={geometry.bbox.bottom_m} units={units} />
                <Distance label="Top face" value_m={geometry.bbox.top_m} units={units} />

                <span className="pt-1 text-[9px] uppercase tracking-[0.08em] text-text-muted">
                  Nearest edges
                </span>
                {/* The letter is the one drawn on that edge of the section, so a number
                    here can be traced to a line on the drawing rather than to an index
                    nobody can see. */}
                {geometry.edges.slice(0, 3).map((e, i) => (
                  <Distance
                    key={e.index}
                    label={`Edge ${e.tag} · ${FACING_LABEL[e.facing]}`}
                    note={i === 0 ? "· nearest" : undefined}
                    value_m={e.distance_m}
                    units={units}
                  />
                ))}

                <span className="pt-1 text-[9px] uppercase tracking-[0.08em] text-text-muted">
                  Nearest corners
                </span>
                {/* Same rule as the edges: the number here is the number drawn on that
                    vertex of the section. */}
                {geometry.corners.slice(0, 3).map((c, i) => (
                  <Distance
                    key={c.index}
                    label={`Corner ${c.tag}`}
                    note={
                      i === 0
                        ? "· nearest"
                        : `· [${c.at[0].toFixed(2)}, ${c.at[1].toFixed(2)}]`
                    }
                    value_m={c.distance_m}
                    units={units}
                  />
                ))}

                <p className="mt-1 border-t border-hairline pt-1 text-[9px] leading-relaxed text-text-muted">
                  Measured on the solved outline_m, in the section plane. The section is{" "}
                  {fmtLen(geometry.extent.w_m, units)} × {fmtLen(geometry.extent.h_m, units)}{" "}
                  {units}.
                </p>
              </div>
            ) : showDistances && !geometry ? (
              <p className="mt-2.5 text-[10px] leading-relaxed text-text-muted">
                This reading came from an elevation, which shows a FACE rather than a cut.
                Distances into the section need a section view.
              </p>
            ) : null}

            {footer && (
              <p className="mt-2.5 border-t border-hairline pt-2 font-mono text-[9px] leading-relaxed tabular-nums text-text-muted">
                {footer}
              </p>
            )}
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-text-muted">
            Click anywhere in the viewer to read the solved temperature there. The reading
            lands in this palette, and the point it was read at is marked in the drawing.
          </p>
        )}
      </div>
    </div>
  );
}
