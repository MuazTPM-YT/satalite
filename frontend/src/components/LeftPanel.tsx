// Element, mix and pour inputs.
//
// Every control on this panel reaches the solver. There is no preview-only section
// any more: the shape list is physics.geometry.SHAPES, the dimension rows are the
// keys that shape's outline() reads, and the mix rows are a design the backend turns
// into hydration parameters through its own equations. If a control cannot be
// translated in lib/elementConfig.ts, it does not belong here.
"use client";

import { useRef } from "react";
import {
  CEMENT_OPTIONS,
  FORMWORK_OPTIONS,
  GRADE_OPTIONS,
  GRID_OPTIONS,
  MIX_BASIS_OPTIONS,
  defaultDims,
  type ElementConfig,
} from "@/lib/elementConfig";
import { SHAPE_BY_ID, SHAPE_DEFS, clampDims, outlineFor, polygonArea_m2, type Outline, type ShapeId } from "@/lib/shapes";
import { mToUnit, unitToM, fmtLen, type LengthUnit } from "@/lib/units";
import { Box, Diamond, FileUp, Layers, Loader2, Sliders } from "lucide-react";
import { Flag, SectionLabel, cx } from "@/components/ui";
import { ScrubField, SelectField } from "@/components/fields";

export interface IfcUiState {
  busy: boolean;
  error: string | null;
  name: string | null;
}

export interface LeftPanelProps {
  config: ElementConfig;
  /**
   * What every Reset control returns to: the scenario the artifact was solved for,
   * read off the response. Hand-typed reset targets drifted from it the moment the
   * artifact was regenerated, and nothing could catch that.
   */
  defaults: ElementConfig;
  onChange: <K extends keyof ElementConfig>(key: K, value: ElementConfig[K]) => void;
  /** one dimension of the current shape, in millimetres */
  onDimChange: (key: string, value_mm: number) => void;
  /** a drag or an edit finished — the moment worth re-solving on */
  onCommit: () => void;
  units: LengthUnit;
  ifc: IfcUiState;
  onImportIfc: (file: File) => void;
  /** the outline the IFC import produced, metres. Drawn instead of the preset preview. */
  importedOutline?: Outline | null;
  /** how many hours of ambient the run has to work with */
  ambientSpan_h: number;
  /** a solve is in flight */
  solving: boolean;
  /** the config has changed since the run on screen */
  stale: boolean;
  onSolve: () => void;
}

// The cross-section drawing, from the same outline generator the request uses.
//
// It is a PREVIEW of the request, not of the answer: it shows the polygon that is
// about to be sent. Once the solve lands, the viewer draws the outline the backend
// returned - and because both come from the same construction, they agree.
function CrossSectionPreview({
  outline,
  units,
  source,
}: {
  outline: Outline | null;
  units: LengthUnit;
  source: string;
}) {
  if (!outline || outline.length < 3) return null;

  const w = Math.max(...outline.map((p) => p[0]));
  const h = Math.max(...outline.map((p) => p[1]));
  const scale = Math.min(150 / w, 118 / h);
  const ox = (200 - w * scale) / 2;
  const oy = 12;
  const pts = outline
    .map(([x, y]) => `${(ox + x * scale).toFixed(1)},${(oy + (h - y) * scale).toFixed(1)}`)
    .join(" ");

  return (
    <div className="mt-2.5 rounded-lg border border-border-default bg-bg-primary p-2">
      <SectionLabel className="mb-1" note={source}>
        Cross-section
      </SectionLabel>
      <svg viewBox="0 0 200 152" className="w-full" xmlns="http://www.w3.org/2000/svg">
        <polygon
          points={pts}
          fill="var(--accent-blue-dim)"
          stroke="var(--draft-line-strong)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <text
          x="100"
          y="146"
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="7.5"
          fontFamily="var(--font-mono)"
        >
          {fmtLen(w, units)} × {fmtLen(h, units)} {units} · {polygonArea_m2(outline).toFixed(3)} m²
        </text>
      </svg>
    </div>
  );
}

// section header. The first one loses its rule so the panel does not open on a line.
function SectionHeader({ title, icon }: { title: string; icon: typeof Box }) {
  return (
    <div className="mt-4 border-t border-border-default pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <SectionLabel icon={icon}>{title}</SectionLabel>
    </div>
  );
}

export default function LeftPanel({
  config,
  defaults,
  onChange,
  onDimChange,
  onCommit,
  units,
  ifc,
  onImportIfc,
  importedOutline,
  ambientSpan_h,
  solving,
  stale,
  onSolve,
}: LeftPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const shapeDef = SHAPE_BY_ID[config.shape];
  const dims = clampDims(config.shape, config.dims_mm);
  const preview = importedOutline ?? outlineFor(config.shape, dims);
  // A dimension resets to the scenario's value only while the shape is still the
  // scenario's; a different shape has different keys, so its own spec is the target.
  const dimDefaults =
    defaults.shape === config.shape
      ? clampDims(config.shape, defaults.dims_mm)
      : defaultDims(config.shape);
  const designing = config.mix_id === "design";

  // Dimensions are edited in the DISPLAY unit and stored in millimetres. The
  // conversion lives here rather than in the field so canonical state never depends
  // on which unit happened to be selected when a value was typed.
  const toDisp = (mm: number) => mToUnit(mm / 1000, units);
  const fromDisp = (v: number) => unitToM(v, units) * 1000;
  // a step that is one millimetre in whatever unit is on screen, floored so `m` gets
  // a usable 0.001 rather than a step finer than the solver's own grid.
  const dimStep = Math.max(toDisp(1), 0.001);

  // The ambient series is finite. A run that starts 20 h in and lasts 72 h would read
  // the last hour of weather flat for its final 20 - so the offset is bounded by what
  // the series can actually cover, and says so.
  const maxOffset_h = Math.max(0, Math.round(ambientSpan_h - config.cure_window_h));

  return (
    <aside className="flex h-full w-full flex-col bg-bg-surface">
      {/* Solve control. Pinned rather than scrolled with the form: it is the answer to
          "I changed something, now what", and that question is asked from anywhere in
          the panel. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-default bg-elevate-1 px-3 py-2">
        <button
          type="button"
          onClick={onSolve}
          disabled={solving}
          className={cx(
            "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold",
            stale && !solving
              ? "bg-accent-blue text-bg-primary"
              : "bg-elevate-2 text-text-secondary hover:bg-elevate-3 hover:text-text-primary",
          )}
        >
          {solving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
              Solving…
            </>
          ) : (
            <>
              <Sliders className="h-3.5 w-3.5" strokeWidth={2.5} />
              {stale ? "Solve with these inputs" : "Re-solve"}
            </>
          )}
        </button>
        {stale && !solving && <Flag tone="amber">changed</Flag>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* ── ELEMENT ─────────────────────────────────────────────────────── */}
        <SectionHeader title="Element" icon={Box} />

        <SelectField<ShapeId>
          label="Shape"
          hint="physics.geometry.SHAPES — what the solver can rasterise"
          value={config.shape}
          options={SHAPE_DEFS.map((s) => ({ id: s.id, label: s.label }))}
          onChange={(v) => {
            onChange("shape", v);
            onCommit();
          }}
        />
        <p className="mb-1.5 pl-[80px] text-[10px] leading-snug text-text-muted">
          {shapeDef.note}
        </p>

        {shapeDef.dims.map((d) => (
          <ScrubField
            key={d.key}
            label={d.label}
            hint={`dims_mm.${d.key}`}
            unit={units}
            value={Number(toDisp(dims[d.key]).toFixed(4))}
            min={toDisp(d.min_mm)}
            max={toDisp(d.max_mm)}
            step={dimStep}
            resetTo={toDisp(dimDefaults[d.key] ?? d.default_mm)}
            onChange={(v) => onDimChange(d.key, fromDisp(v))}
            onCommit={onCommit}
          />
        ))}

        <ScrubField
          label="Length"
          hint="View only. The solve is 2D, so length extrudes the answer rather than changing it."
          unit={units}
          value={Number(toDisp(config.length_mm).toFixed(4))}
          min={toDisp(500)}
          max={toDisp(30000)}
          step={dimStep}
          resetTo={toDisp(defaults.length_mm)}
          onChange={(v) => onChange("length_mm", fromDisp(v))}
        />
        <p className="mb-1 pl-[80px] text-[10px] leading-snug text-text-muted">
          Extrusion only — no physics runs along the length.
        </p>

        <SelectField
          label="Formwork"
          hint="physics.equations.boundary.FORMWORK_R"
          value={config.formwork}
          options={FORMWORK_OPTIONS.map((f) => ({ id: f.id, label: f.label, note: f.note }))}
          onChange={(v) => {
            onChange("formwork", v);
            onCommit();
          }}
        />
        <SelectField
          label="Grid"
          hint="dx_m — cell pitch. The biggest lever on solve time."
          value={String(config.dx_m)}
          options={GRID_OPTIONS.map((g) => ({ id: g.id, label: g.label, note: g.note }))}
          onChange={(v) => {
            onChange("dx_m", Number(v));
            onCommit();
          }}
        />

        {/* IFC import */}
        <div className="flex items-center gap-1.5 py-1">
          <label htmlFor="ifc-file" className="w-[74px] shrink-0 truncate text-[11px] text-text-secondary">
            Import IFC
          </label>
          <input
            ref={fileRef}
            id="ifc-file"
            type="file"
            accept=".ifc"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportIfc(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-elevate-2 px-2.5 text-[11px] font-medium text-text-secondary hover:bg-elevate-3 hover:text-text-primary"
            onClick={() => fileRef.current?.click()}
            disabled={ifc.busy}
          >
            <FileUp className="h-3.5 w-3.5" strokeWidth={2} />
            {ifc.busy ? "Parsing…" : "Choose file"}
          </button>
        </div>
        {ifc.error && (
          <p className="mb-2 mt-1 rounded-lg border border-status-red/30 bg-status-red-dim px-2.5 py-2 font-mono text-[10px] leading-relaxed text-status-red">
            {ifc.error}
          </p>
        )}
        {importedOutline && ifc.name && (
          <p className="mb-1 mt-1 text-[10px] leading-snug text-text-muted">
            Outline from <span className="text-text-secondary">{ifc.name}</span>. The solver
            takes a named shape and dimensions, not an arbitrary polygon, so this is drawn
            as reference only — pick the preset it matches to solve it.
          </p>
        )}

        <CrossSectionPreview
          outline={preview}
          units={units}
          source={importedOutline ? "from IFC" : "about to be solved"}
        />

        {/* ── MIX ─────────────────────────────────────────────────────────── */}
        <SectionHeader title="Mix" icon={Diamond} />

        <SelectField
          label="Grade"
          hint="physics.strength_model.GRADE_PARAMS — calibrated grades only"
          value={config.grade}
          options={GRADE_OPTIONS.map((g) => ({ id: g.id, label: g.label, note: g.note }))}
          onChange={(v) => {
            onChange("grade", v);
            onCommit();
          }}
        />
        <SelectField
          label="Mix basis"
          hint="What goes on the wire: the backend's standard mix, or the rows below"
          value={config.mix_id}
          options={MIX_BASIS_OPTIONS.map((m) => ({ id: m.id, label: m.label, note: m.note }))}
          onChange={(v) => {
            onChange("mix_id", v);
            onCommit();
          }}
        />
        {!designing && (
          <p className="mb-1.5 pl-[80px] text-[10px] leading-snug text-text-muted">
            Backend derives the hydration parameters. The ensemble band and season
            replay were solved with this mix.
          </p>
        )}
        <SelectField
          label="Cement"
          hint="ASTM C150 type — sets cement heat. physics.constants.H_CEM_BY_TYPE"
          disabled={!designing}
          value={config.cement_type}
          options={CEMENT_OPTIONS.map((c) => ({ id: c.id, label: c.label, note: c.note }))}
          onChange={(v) => {
            onChange("cement_type", v);
            onCommit();
          }}
        />
        <ScrubField
          label="Content"
          hint="cementitious_kg_m3 — cement + fly ash + any SCM"
          unit="kg/m³"
          value={config.cementitious_kg_m3}
          min={200}
          max={700}
          step={5}
          resetTo={defaults.cementitious_kg_m3}
          disabled={!designing}
          onChange={(v) => onChange("cementitious_kg_m3", v)}
          onCommit={onCommit}
        />
        <ScrubField
          label="w/cm"
          hint="Water/cementitious — drives ultimate hydration"
          value={config.wcm}
          min={0.25}
          max={0.75}
          step={0.01}
          resetTo={defaults.wcm}
          disabled={!designing}
          onChange={(v) => onChange("wcm", v)}
          onCommit={onCommit}
        />
        <ScrubField
          label="Fly ash"
          hint="Replacement by mass. Class F assumed at 6% CaO."
          unit="%"
          value={config.fly_ash_pct}
          min={0}
          max={50}
          step={1}
          resetTo={defaults.fly_ash_pct}
          disabled={!designing}
          onChange={(v) => onChange("fly_ash_pct", v)}
          onCommit={onCommit}
        />
        <ScrubField
          label="Placement"
          hint="placement_temp_c — concrete temperature at discharge"
          unit="°C"
          value={config.placement_temp_c}
          min={0}
          // 50 C is app/models ElementSpec's own bound. A wider slider here would
          // send a request the backend answers with a 422.
          max={50}
          step={0.5}
          resetTo={defaults.placement_temp_c}
          onChange={(v) => onChange("placement_temp_c", v)}
          onCommit={onCommit}
        />

        {/* ── POUR ────────────────────────────────────────────────────────── */}
        <SectionHeader title="Pour" icon={Layers} />

        <ScrubField
          label="Cure window"
          hint="duration_hours — how long the solve runs"
          unit="h"
          value={config.cure_window_h}
          min={12}
          max={Math.min(336, Math.round(ambientSpan_h))}
          step={1}
          resetTo={defaults.cure_window_h}
          onChange={(v) => onChange("cure_window_h", v)}
          onCommit={onCommit}
        />
        <ScrubField
          label="Start offset"
          hint="Slides the run along the ambient series, as /api/pour-windows does"
          unit="h"
          value={config.start_offset_h}
          min={0}
          max={maxOffset_h}
          step={1}
          resetTo={0}
          disabled={maxOffset_h === 0}
          onChange={(v) => onChange("start_offset_h", v)}
          onCommit={onCommit}
        />
        <ScrubField
          label="t_ref"
          hint="Maturity reference. Must match the strength calibration."
          unit="°C"
          value={config.t_ref_c}
          min={5}
          max={40}
          step={0.5}
          resetTo={defaults.t_ref_c}
          onChange={(v) => onChange("t_ref_c", v)}
          onCommit={onCommit}
        />

        <p className="mt-2 rounded-lg border border-border-default bg-elevate-1 px-2.5 py-2 text-[10px] leading-relaxed text-text-muted">
          {maxOffset_h === 0 ? (
            <>
              The cure window uses all {ambientSpan_h.toFixed(0)} h of the ambient series.
              Shorten it to slide the start.
            </>
          ) : (
            <>
              Weather is the cached series from the demo scenario — real data that was
              solved, not a forecast fetched now. The offset moves the pour along its
              {ambientSpan_h.toFixed(0)} h.
            </>
          )}
        </p>
      </div>
    </aside>
  );
}
