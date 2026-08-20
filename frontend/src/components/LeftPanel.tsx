// left panel. element geometry, mix design, pour details
"use client";

// static T-beam cross-section SVG preview
function CrossSectionPreview() {
  return (
    <div className="mt-2 p-2 bg-bg-primary rounded-md border border-border-default">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
          Cross-Section
        </span>
        <span className="text-[10px] text-text-muted">1:15</span>
      </div>
      <svg
        viewBox="0 0 200 160"
        className="w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* T-beam shape: flange on top, web below */}
        {/* flange: 600mm wide × 150mm deep → scaled */}
        <rect
          x="20" y="10" width="160" height="40"
          fill="none" stroke="#8b949e" strokeWidth="1.5"
        />
        {/* web: 250mm wide × 350mm deep → scaled */}
        <rect
          x="70" y="50" width="60" height="100"
          fill="none" stroke="#8b949e" strokeWidth="1.5"
        />
        {/* dimension lines */}
        {/* flange width */}
        <line x1="20" y1="5" x2="180" y2="5" stroke="#6e7681" strokeWidth="0.5" />
        <line x1="20" y1="2" x2="20" y2="8" stroke="#6e7681" strokeWidth="0.5" />
        <line x1="180" y1="2" x2="180" y2="8" stroke="#6e7681" strokeWidth="0.5" />
        <text x="100" y="4" textAnchor="middle" fill="#6e7681" fontSize="7">600</text>
        {/* web width */}
        <line x1="70" y1="155" x2="130" y2="155" stroke="#6e7681" strokeWidth="0.5" />
        <line x1="70" y1="152" x2="70" y2="158" stroke="#6e7681" strokeWidth="0.5" />
        <line x1="130" y1="152" x2="130" y2="158" stroke="#6e7681" strokeWidth="0.5" />
        <text x="100" y="154" textAnchor="middle" fill="#6e7681" fontSize="7">250</text>
        {/* total depth */}
        <line x1="190" y1="10" x2="190" y2="150" stroke="#6e7681" strokeWidth="0.5" />
        <line x1="187" y1="10" x2="193" y2="10" stroke="#6e7681" strokeWidth="0.5" />
        <line x1="187" y1="150" x2="193" y2="150" stroke="#6e7681" strokeWidth="0.5" />
        <text x="195" y="83" textAnchor="start" fill="#6e7681" fontSize="7" transform="rotate(90,195,83)">500</text>
      </svg>
    </div>
  );
}

// form row with label + input
function FormRow({
  label,
  value,
  unit,
  type = "number",
  id,
}: {
  label: string;
  value: string | number;
  unit?: string;
  type?: string;
  id: string;
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
          defaultValue={value}
          className="w-16 text-right text-xs"
          readOnly
        />
        {unit && (
          <span className="text-[10px] text-text-muted w-8">{unit}</span>
        )}
      </div>
    </div>
  );
}

// dropdown row
function SelectRow({
  label,
  value,
  options,
  id,
}: {
  label: string;
  value: string;
  options: string[];
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <label htmlFor={id} className="text-xs text-text-secondary whitespace-nowrap">
        {label}
      </label>
      <select id={id} defaultValue={value} className="text-xs max-w-[130px]">
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

export default function LeftPanel() {
  return (
    <aside className="w-[260px] shrink-0 bg-bg-surface border-r border-border-default overflow-y-auto">
      <div className="p-3">
        {/* ELEMENT section */}
        <SectionHeader title="Element" icon="◧" />

        <SelectRow
          id="shape"
          label="Shape"
          value="T-Beam"
          options={["T-Beam", "Rectangle", "I-Beam", "Box"]}
        />
        <FormRow id="flange-width" label="Flange width" value={600} unit="mm" />
        <FormRow id="flange-depth" label="Flange depth" value={150} unit="mm" />
        <FormRow id="web-width" label="Web width" value={250} unit="mm" />
        <FormRow id="total-depth" label="Total depth" value={500} unit="mm" />
        <FormRow id="length" label="Length" value={6000} unit="mm" />

        <SelectRow
          id="formwork"
          label="Formwork"
          value="Plywood 18 mm"
          options={["Plywood 18 mm", "Steel", "Insulated"]}
        />
        <SelectRow
          id="top-face"
          label="Top face"
          value="Exposed"
          options={["Exposed", "Covered", "Insulated"]}
        />
        <SelectRow
          id="soffit"
          label="Soffit"
          value="Formed"
          options={["Formed", "Ground"]}
        />

        <CrossSectionPreview />

        {/* MIX section */}
        <SectionHeader title="Mix" icon="◇" />

        <SelectRow
          id="grade"
          label="Grade"
          value="4000 psi (28 MPa)"
          options={["3000 psi (21 MPa)", "4000 psi (28 MPa)", "5000 psi (35 MPa)", "6000 psi (42 MPa)"]}
        />
        <SelectRow
          id="cement"
          label="Cement"
          value="Type I/II"
          options={["Type I", "Type I/II", "Type II", "Type III", "Type V"]}
        />
        <FormRow id="content" label="Content" value={400} unit="kg/m³" />
        <FormRow id="wcm" label="w/cm" value={0.45} />
        <FormRow id="fly-ash" label="Fly ash" value={20} unit="%" />
        <FormRow id="placement-temp" label="Placement temp" value={29} unit="°C" />

        {/* POUR section */}
        <SectionHeader title="Pour" icon="◈" />

        <FormRow id="pour-date" label="Date" value="2026-08-22" type="text" />
        <FormRow id="start-time" label="Start time" value="04:00" type="text" />
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
        <FormRow id="cure-window" label="Cure window" value={72} unit="h" />
      </div>
    </aside>
  );
}
