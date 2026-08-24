// The probe readout, shared by the 2D sheet and the 3D viewer.
//
// One card in both places on purpose: a temperature read at a point is the same
// answer whichever viewer asked, and two cards would eventually drift into showing
// it two different ways.
//
// The distances are geometry, not physics. They are measured against the SOLVED
// outline the backend returned, so "42 mm to the nearest face" is a distance to the
// concrete the solver actually ran on - not to a shape rebuilt from the input boxes.
"use client";

import type { ReactNode } from "react";
import { Crosshair, Ruler, Target } from "lucide-react";
import type { Sample } from "@/lib/probe";
import { FACING_LABEL, type ProbeGeometry } from "@/lib/sectionMetrics";
import { fmtLen, type LengthUnit } from "@/lib/units";
import { Flag, SectionLabel, Toolbar, cx } from "@/components/ui";

interface ProbeCardProps {
  sample: Sample | null;
  geometry: ProbeGeometry | null;
  units: LengthUnit;
  showDistances: boolean;
  onToggleDistances: () => void;
  /** offered only where the backend's own point is meaningful */
  onSampleBackendPoint?: () => void;
  emptyHint: string;
  footer?: ReactNode;
}

// one distance row: what it is measured to, and how far.
function Distance({ label, value_m, units, note }: { label: string; value_m: number; units: LengthUnit; note?: string }) {
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

export default function ProbeCard({
  sample,
  geometry,
  units,
  showDistances,
  onToggleDistances,
  onSampleBackendPoint,
  emptyHint,
  footer,
}: ProbeCardProps) {
  return (
    <Toolbar className="flex-col items-stretch gap-1.5 !p-2.5">
      <div className="flex items-center gap-2">
        <Crosshair className="h-3.5 w-3.5 shrink-0 text-accent-blue" strokeWidth={2} />
        <SectionLabel>Probe</SectionLabel>
        {sample?.fallback && <Flag tone="amber">nearest cell</Flag>}
        {sample && (
          <button
            type="button"
            onClick={onToggleDistances}
            aria-pressed={showDistances}
            title="Distances from this point to the section's faces and corners"
            className={cx(
              "ml-auto flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium",
              showDistances
                ? "bg-accent-blue-dim text-accent-blue"
                : "text-text-muted hover:bg-elevate-2 hover:text-text-primary",
            )}
          >
            <Ruler className="h-3 w-3" strokeWidth={2} />
            Distances
          </button>
        )}
      </div>

      {sample ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[20px] font-semibold leading-none tabular-nums text-text-primary">
              {sample.temp_c.toFixed(2)}
            </span>
            <span className="font-mono text-[11px] text-text-muted">°C</span>
          </div>
          <span className="font-mono text-[10px] tabular-nums text-text-muted">
            [{sample.xy_m[0].toFixed(3)}, {sample.xy_m[1].toFixed(3)}] m in the section
          </span>
          {sample.fallback && (
            <span className="text-[10px] leading-snug text-status-amber">
              The 2×2 straddled a hole or the outside — this is the nearest solid cell.
            </span>
          )}

          {showDistances && geometry && (
            <div className="mt-1 flex flex-col gap-1 rounded-lg border border-hairline bg-bg-primary/60 p-2">
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
              {geometry.corners.slice(0, 3).map((c) => (
                <Distance
                  key={c.index}
                  label={`Corner ${c.index + 1}`}
                  note={`· [${c.at[0].toFixed(2)}, ${c.at[1].toFixed(2)}]`}
                  value_m={c.distance_m}
                  units={units}
                />
              ))}

              <p className="mt-1 border-t border-hairline pt-1 text-[9px] leading-relaxed text-text-muted">
                Measured on the solved outline_m, in the section plane. The section is{" "}
                {fmtLen(geometry.extent.w_m, units)} × {fmtLen(geometry.extent.h_m, units)} {units}.
              </p>
            </div>
          )}
        </>
      ) : (
        <span className="text-[11px] leading-snug text-text-muted">{emptyHint}</span>
      )}

      {onSampleBackendPoint && (
        <button
          type="button"
          onClick={onSampleBackendPoint}
          className={cx(
            "pointer-events-auto mt-0.5 flex h-7 items-center justify-center gap-1.5 rounded-lg",
            "bg-elevate-2 px-2.5 text-[11px] font-medium text-text-secondary",
            "hover:bg-elevate-3 hover:text-text-primary",
          )}
        >
          <Target className="h-3.5 w-3.5" strokeWidth={2} />
          Sample the backend&apos;s own point
        </button>
      )}

      {footer && (
        <span className="border-t border-hairline pt-1.5 font-mono text-[9px] leading-relaxed tabular-nums text-text-muted">
          {footer}
        </span>
      )}
    </Toolbar>
  );
}
