// left panel. element geometry, mix design, pour details — reads/writes shared element config
// geometry inputs display in the selected length unit, canonical state stays mm
"use client";

import { useRef } from "react";
import type { ElementConfig } from "@/lib/elementConfig";
import { mToUnit, unitToM, fmtLen, roundDisp, type LengthUnit } from "@/lib/units";
import { createOutlineForShape } from "@/lib/outline";

// shape value used when geometry came from an IFC file
export const IMPORTED_SHAPE = "Imported (IFC)";

export interface IfcUiState {
  busy: boolean;
  error: string | null;
  name: string | null;
}

interface LeftPanelProps {
  config: ElementConfig;
  onChange: <K extends keyof ElementConfig>(key: K, value: ElementConfig[K]) => void;
  units: LengthUnit;
  ifc: IfcUiState;
  // file chosen by user, parent runs the import
  onImportIfc: (file: File) => void;
  // extracted outline metres, drives preview when shape imported
  importedOutline?: [number, number][] | null;
}

// dynamic cross-section SVG preview — real outline, imported or preset-generated
function CrossSectionPreview({
  config,
  units,
  outline,
}: {
  config: ElementConfig;
  units: LengthUnit;
  outline?: [number, number][];
}) {
  // imported outline wins; otherwise generate from current shape + dims
  const pts: [number, number][] =
    outline && outline.length >= 3
      ? outline
      : createOutlineForShape(
          config.shape,
          config.flange_width_mm / 1000,
          config.flange_depth_mm / 1000,
          config.web_width_mm / 1000,
          config.total_depth_mm / 1000
        ) ?? [];
  if (pts.length < 3) return null;

  const isIFC = !!(outline && outline.length >= 3);
  const w = Math.max(...pts.map((p) => p[0]));
  const h = Math.max(...pts.map((p) => p[1]));
  const scale = Math.min(160 / w, 140 / h);
  const px = pts.map(([x, y]) => `${(20 + x * scale).toFixed(1)},${(10 + (h - y) * scale).toFixed(1)}`).join(" ");

  return (
    <div className="mt-2 p-2 bg-bg-primary rounded-sm border border-border-default">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
          Cross-Section
        </span>
        <span className="text-[10px] text-text-muted">{isIFC ? "IFC" : "fit"}</span>
      </div>
      <svg viewBox="0 0 200 160" className="w-full" xmlns="http://www.w3.org/2000/svg">
        <polygon points={px} fill="none" stroke="#8b949e" strokeWidth="1.5" />
        <text x="100" y="158" textAnchor="middle" fill="#6e7681" fontSize="7">
          {fmtLen(w, units)} × {fmtLen(h, units)}
        </text>
      </svg>
    </div>
  );
}

// form row with label + controlled input, readOnly when driven by IFC outline
function FormRow({
  label,
  value,
  unit,
  type = "number",
  id,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  type?: string;
  id: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <label htmlFor={id} className="text-xs text-text-secondary whitespace-nowrap">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={readOnly}
          className="w-16 text-right text-xs"
        />
        {unit && (
          <span className="text-[10px] text-text-muted w-8">{unit}</span>
        )}
      </div>
    </div>
  );
}

// dropdown row with controlled select
function SelectRow({
  label,
  value,
  options,
  id,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  id: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <label htmlFor={id} className="text-xs text-text-secondary whitespace-nowrap">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="text-xs max-w-[130px]">
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

// collapsible section header
function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex items-center gap-1.5 py-2 mt-1 border-t border-border-default">
      <span className="text-[10px] text-text-muted">{icon}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
        {title}
      </span>
    </div>
  );
}

export default function LeftPanel({ config, onChange, units, ifc, onImportIfc, importedOutline }: LeftPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isImported = config.shape === IMPORTED_SHAPE;

  // mm canonical -> display-unit number for inputs
  const disp = (mm: number) => roundDisp(mToUnit(mm / 1000, units));
  // display-unit string -> mm canonical
  const setDim =
    (key: keyof ElementConfig) =>
    (v: string) =>
      onChange(key, unitToM(Number(v), units) * 1000);

  return (
    <aside className="w-[260px] shrink-0 bg-bg-surface overflow-y-auto">
      <div className="p-3">
        {/* ELEMENT section */}
        <SectionHeader title="Element" icon="◧" />

        {/* said plainly rather than implied: nothing below changes the solve yet. The
            section on screen comes from the response, not from these boxes. */}
        <p className="mb-2 text-[10px] leading-relaxed text-text-muted bg-bg-primary border border-border-default rounded-sm px-2 py-1.5">
          Preview only — these inputs do not drive the solve yet. The section in the viewer
          is the solved geometry the backend returned.
        </p>

        <SelectRow
          id="shape"
          label="Shape"
          value={config.shape}
          options={isImported ? ["T-Beam", "Rectangle", IMPORTED_SHAPE] : ["T-Beam", "Rectangle"]}
          onChange={(v) => onChange("shape", v)}
        />

        {/* IFC import picker + status */}
        <div className="flex items-center justify-between gap-2 py-1">
          <label htmlFor="ifc-file" className="text-xs text-text-secondary whitespace-nowrap">
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
            className="px-2 py-1 text-[10px] font-medium rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
            onClick={() => fileRef.current?.click()}
            disabled={ifc.busy}
          >
            {ifc.busy ? "Parsing…" : "Choose file…"}
          </button>
        </div>
        {ifc.error && (
          <p className="mt-1 mb-2 text-[10px] leading-relaxed text-status-red bg-status-red-dim border border-status-red rounded-sm px-2 py-1.5">
            {ifc.error}
          </p>
        )}
        {isImported && ifc.name && (
          <p className="mt-1 mb-2 text-[10px] text-text-muted">
            Geometry from IFC: <span className="text-text-secondary">{ifc.name}</span>. Flange/web inputs are preset-only — pick a preset shape to edit them.
          </p>
        )}

        {isImported ? (
          <>
            <FormRow readOnly id="flange-width" label="Section width" value={disp(config.flange_width_mm)} unit={units} />
            <FormRow readOnly id="total-depth" label="Section depth" value={disp(config.total_depth_mm)} unit={units} />
            <FormRow readOnly id="length" label="Length" value={disp(config.length_mm)} unit={units} />
          </>
        ) : (
          <>
            <FormRow id="flange-width" label="Flange width" value={disp(config.flange_width_mm)} unit={units} onChange={setDim("flange_width_mm")} />
            <FormRow id="flange-depth" label="Flange depth" value={disp(config.flange_depth_mm)} unit={units} onChange={setDim("flange_depth_mm")} />
            <FormRow id="web-width" label="Web width" value={disp(config.web_width_mm)} unit={units} onChange={setDim("web_width_mm")} />
            <FormRow id="total-depth" label="Total depth" value={disp(config.total_depth_mm)} unit={units} onChange={setDim("total_depth_mm")} />
            <FormRow id="length" label="Length" value={disp(config.length_mm)} unit={units} onChange={setDim("length_mm")} />
          </>
        )}

        <SelectRow
          id="formwork"
          label="Formwork"
          value={config.formwork}
          options={["Plywood 18 mm", "Steel", "Insulated"]}
          onChange={(v) => onChange("formwork", v)}
        />
        <SelectRow
          id="top-face"
          label="Top face"
          value={config.top_face}
          options={["Exposed", "Covered", "Insulated"]}
          onChange={(v) => onChange("top_face", v)}
        />
        <SelectRow
          id="soffit"
          label="Soffit"
          value={config.soffit}
          options={["Formed", "Ground"]}
          onChange={(v) => onChange("soffit", v)}
        />

        <CrossSectionPreview config={config} units={units} outline={importedOutline ?? undefined} />

        {/* MIX section */}
        <SectionHeader title="Mix" icon="◇" />

        <SelectRow
          id="grade"
          label="Grade"
          value={config.grade}
          options={["3000 psi (21 MPa)", "4000 psi (28 MPa)", "5000 psi (35 MPa)", "6000 psi (42 MPa)"]}
          onChange={(v) => onChange("grade", v)}
        />
        <SelectRow
          id="cement"
          label="Cement"
          value={config.cement}
          options={["Type I", "Type I/II", "Type II", "Type III", "Type V"]}
          onChange={(v) => onChange("cement", v)}
        />
        <FormRow id="content" label="Content" value={config.content_kgm3} unit="kg/m³" onChange={(v) => onChange("content_kgm3", Number(v))} />
        <FormRow id="wcm" label="w/cm" value={config.wcm} onChange={(v) => onChange("wcm", Number(v))} />
        <FormRow id="fly-ash" label="Fly ash" value={config.fly_ash_pct} unit="%" onChange={(v) => onChange("fly_ash_pct", Number(v))} />
        <FormRow id="placement-temp" label="Placement temp" value={config.placement_temp_c} unit="°C" onChange={(v) => onChange("placement_temp_c", Number(v))} />

        {/* POUR section */}
        <SectionHeader title="Pour" icon="◈" />

        <FormRow id="pour-date" label="Date" value={config.pour_date} type="text" onChange={(v) => onChange("pour_date", v)} />
        <FormRow id="start-time" label="Start time" value={config.start_time} type="text" onChange={(v) => onChange("start_time", v)} />
        <div className="flex items-center justify-between gap-2 py-1">
          <label className="text-xs text-text-secondary">Wind</label>
          <div className="flex items-center gap-1">
            <span className="px-2 py-0.5 text-[10px] rounded bg-accent-blue-dim text-accent-blue font-medium">
              Auto
            </span>
            <span className="text-xs text-text-primary">·</span>
            <span className="text-xs text-text-primary">2.4</span>
            <span className="text-[10px] text-text-muted">m/s</span>
          </div>
        </div>
        <FormRow id="cure-window" label="Cure window" value={config.cure_window_h} unit="h" onChange={(v) => onChange("cure_window_h", Number(v))} />
      </div>
    </aside>
  );
}
