// left panel. element geometry, mix design, pour details — reads/writes shared element config
"use client";

import type { ElementConfig } from "@/lib/elementConfig";

interface LeftPanelProps {
  config: ElementConfig;
  onChange: <K extends keyof ElementConfig>(key: K, value: ElementConfig[K]) => void;
}

// dynamic T-beam cross-section SVG preview from shared config dims
function CrossSectionPreview({ config }: { config: ElementConfig }) {
  const fw = config.flange_width_mm;
  const fd = config.flange_depth_mm;
  const ww = config.web_width_mm;
  const td = config.total_depth_mm;

  // fit shape into fixed preview box
  const box_w = 160;
  const box_h = 140;
  const scale = Math.min(box_w / fw, box_h / td);
  const fw_px = fw * scale;
  const fd_px = fd * scale;
  const ww_px = ww * scale;
  const td_px = td * scale;
  const x0 = 20;
  const y0 = 10;
  const webX = x0 + (fw_px - ww_px) / 2;

  return (
    <div className="mt-2 p-2 bg-bg-primary rounded-md border border-border-default">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
          Cross-Section
        </span>
        <span className="text-[10px] text-text-muted">fit</span>
      </div>
      <svg
        viewBox="0 0 200 160"
        className="w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* T-beam shape: flange on top, web below */}
        <rect
          x={x0} y={y0} width={fw_px} height={fd_px}
          fill="none" stroke="#8b949e" strokeWidth="1.5"
        />
        <rect
          x={webX} y={y0 + fd_px} width={ww_px} height={td_px - fd_px}
          fill="none" stroke="#8b949e" strokeWidth="1.5"
        />
        {/* dimension lines */}
        <line x1={x0} y1={y0 - 5} x2={x0 + fw_px} y2={y0 - 5} stroke="#6e7681" strokeWidth="0.5" />
        <line x1={x0} y1={y0 - 8} x2={x0} y2={y0 - 2} stroke="#6e7681" strokeWidth="0.5" />
        <line x1={x0 + fw_px} y1={y0 - 8} x2={x0 + fw_px} y2={y0 - 2} stroke="#6e7681" strokeWidth="0.5" />
        <text x={x0 + fw_px / 2} y={y0 - 6} textAnchor="middle" fill="#6e7681" fontSize="7">{fw}</text>
        <line x1={webX} y1={y0 + td_px + 5} x2={webX + ww_px} y2={y0 + td_px + 5} stroke="#6e7681" strokeWidth="0.5" />
        <line x1={webX} y1={y0 + td_px + 2} x2={webX} y2={y0 + td_px + 8} stroke="#6e7681" strokeWidth="0.5" />
        <line x1={webX + ww_px} y1={y0 + td_px + 2} x2={webX + ww_px} y2={y0 + td_px + 8} stroke="#6e7681" strokeWidth="0.5" />
        <text x={webX + ww_px / 2} y={y0 + td_px + 14} textAnchor="middle" fill="#6e7681" fontSize="7">{ww}</text>
        <line x1={x0 + fw_px + 10} y1={y0} x2={x0 + fw_px + 10} y2={y0 + td_px} stroke="#6e7681" strokeWidth="0.5" />
        <line x1={x0 + fw_px + 7} y1={y0} x2={x0 + fw_px + 13} y2={y0} stroke="#6e7681" strokeWidth="0.5" />
        <line x1={x0 + fw_px + 7} y1={y0 + td_px} x2={x0 + fw_px + 13} y2={y0 + td_px} stroke="#6e7681" strokeWidth="0.5" />
        <text x={x0 + fw_px + 16} y={y0 + td_px / 2} textAnchor="middle" fill="#6e7681" fontSize="7" transform={`rotate(90 ${x0 + fw_px + 16} ${y0 + td_px / 2})`}>{td}</text>
      </svg>
    </div>
  );
}

// form row with label + controlled input
function FormRow({
  label,
  value,
  unit,
  type = "number",
  id,
  onChange,
}: {
  label: string;
  value: string | number;
  unit?: string;
  type?: string;
  id: string;
  onChange: (value: string) => void;
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
          onChange={(e) => onChange(e.target.value)}
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

export default function LeftPanel({ config, onChange }: LeftPanelProps) {
  return (
    <aside className="w-[260px] shrink-0 bg-bg-surface border-r border-border-default overflow-y-auto">
      <div className="p-3">
        {/* ELEMENT section */}
        <SectionHeader title="Element" icon="◧" />

        <SelectRow
          id="shape"
          label="Shape"
          value={config.shape}
          options={["T-Beam", "Rectangle", "I-Beam", "Box"]}
          onChange={(v) => onChange("shape", v)}
        />
        <FormRow id="flange-width" label="Flange width" value={config.flange_width_mm} unit="mm" onChange={(v) => onChange("flange_width_mm", Number(v))} />
        <FormRow id="flange-depth" label="Flange depth" value={config.flange_depth_mm} unit="mm" onChange={(v) => onChange("flange_depth_mm", Number(v))} />
        <FormRow id="web-width" label="Web width" value={config.web_width_mm} unit="mm" onChange={(v) => onChange("web_width_mm", Number(v))} />
        <FormRow id="total-depth" label="Total depth" value={config.total_depth_mm} unit="mm" onChange={(v) => onChange("total_depth_mm", Number(v))} />
        <FormRow id="length" label="Length" value={config.length_mm} unit="mm" onChange={(v) => onChange("length_mm", Number(v))} />

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

        <CrossSectionPreview config={config} />

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
