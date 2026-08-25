// validation against the USBR cases.
//
// One of three cases passes. That is the headline and it is not buried: the two field
// failures are rendered first, at full detail, and the adiabatic pass comes last with an
// explicit statement that it does not validate them. A validation screen that reports a
// failure is the only kind worth believing, so nothing here is softened, folded away or
// summarised into a percentage.
"use client";

import type { ValidationCase, ValidationResponse } from "@/lib/api";
import { SectionLabel, SectionTitle } from "@/components/ui";
import { useTooltip } from "@/components/Tooltip";

interface ValidationPanelProps {
  validation: ValidationResponse;
}

/** One coverage checkpoint: whether the measurement fell inside the predicted band. */
function Checkpoint({ inside, at_h, index }: { inside: boolean; at_h?: number; index: number }) {
  const tip = useTooltip(
    at_h === undefined ? null : (
      <>
        <span className="block font-mono tabular-nums">{at_h} h after placement</span>
        <span className={inside ? "text-status-green" : "text-status-red"}>
          measured {inside ? "inside" : "outside"} the predicted band
        </span>
      </>
    ),
    "top",
  );
  return (
    <>
      <span
        {...tip.trigger}
        className={`rounded-sm px-1 text-[9px] ${
          inside ? "bg-status-green-dim text-status-green" : "bg-status-red-dim text-status-red"
        }`}
      >
        {at_h !== undefined ? `${at_h}h` : index + 1}
      </span>
      {tip.node}
    </>
  );
}

export default function ValidationPanel({ validation }: ValidationPanelProps) {
  const cases = validation.cases;
  const passed = cases.filter((c) => c.passed).length;
  const field = cases.filter((c) => c.kind === "field");
  const other = cases.filter((c) => c.kind !== "field");
  const fieldPassed = field.filter((c) => c.passed).length;

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-surface">
      <div className="p-3">
        {/* the headline, stated plainly and first */}
        <div className="rounded-lg border border-border-default bg-elevate-1 p-3">
          <div className="text-lg font-semibold text-text-primary tabular-nums">
            {passed} of {cases.length} cases pass
          </div>
          <div className="mt-0.5 text-xs text-status-red tabular-nums">
            {fieldPassed} of {field.length} FIELD cases pass
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
            <span className="text-text-muted">primary_metric</span>
            <span className="text-text-secondary">{validation.primary_metric}</span>
            <span className="text-text-muted">coverage_pass_pct</span>
            <span className="text-text-secondary">
              {validation.coverage_pass_pct ?? "—"}% of checkpoints must fall inside the band
            </span>
            <span className="text-text-muted">band_width_warn_c</span>
            <span className="text-text-secondary">
              {validation.band_width_warn_c ?? "—"} °C — a peak band wider than this is flagged
            </span>
            <span className="text-text-muted">n_samples</span>
            <span className="text-text-secondary">{validation.n_samples ?? "—"}</span>
            <span className="text-text-muted">generated_at</span>
            <span className="text-text-secondary">{validation.generated_at ?? "—"}</span>
          </div>
          <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
            The metric is band COVERAGE, not point error: DSO-12-02 publishes no cement
            chemistry, so a point prediction would be testing four unmeasured numbers.
          </p>
        </div>

        {field.length > 0 && (
          <div className="mt-3">
            <SectionTitle
              title={`Field cases — ${fieldPassed} of ${field.length} pass`}
              subtitle="measured thermocouples in a real placement"
            />
            {field.map((c) => (
              <CaseCard key={c.case_id} c={c} warn_c={validation.band_width_warn_c} />
            ))}
          </div>
        )}

        {other.length > 0 && (
          <div className="mt-3">
            <SectionTitle
              title="Laboratory case"
              subtitle="a different test, reported separately on purpose"
            />
            <p className="mb-1.5 rounded-lg border border-border-default bg-elevate-1 p-2 text-[10px] leading-relaxed text-text-secondary">
              This is an adiabatic calorimeter measurement: no boundary, no weather, no
              geometry — it tests the hydration heat alone against a single checkpoint. It
              says nothing about whether the solver reproduces a real placement, and the two
              field cases above are the evidence on that question. Passing here does not
              carry over.
            </p>
            {other.map((c) => (
              <CaseCard key={c.case_id} c={c} warn_c={validation.band_width_warn_c} />
            ))}
          </div>
        )}

        {/* what the whole exercise is conditional on */}
        {validation.notes.length > 0 && (
          <div className="mt-3 p-2.5 rounded-lg border border-border-default bg-elevate-1">
            <SectionLabel className="mb-1.5">
              Report notes — all {validation.notes.length}, verbatim
            </SectionLabel>
            <ul className="flex flex-col gap-1.5">
              {validation.notes.map((n, i) => (
                <li key={i} className="text-[10px] text-text-secondary leading-relaxed pl-3 border-l border-border-strong">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}

        {Object.keys(validation.assumed_chemistry_ranges).length > 0 && (
          <div className="mt-3 p-2.5 rounded-lg border border-border-default bg-elevate-1">
            <SectionLabel className="mb-1">assumed_chemistry_ranges</SectionLabel>
            <p className="mb-1.5 text-[10px] text-status-amber leading-relaxed">
              ASSUMPTIONS, not measurements. The source reports no oxide analysis; these are
              typical published ASTM C150 ranges for the stated cement type.
            </p>
            {Object.entries(validation.assumed_chemistry_ranges).map(([type, params]) => (
              <div key={type} className="mt-1">
                <span className="text-[10px] text-text-primary">Type {type}</span>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 text-[10px] tabular-nums">
                  {Object.entries(params).map(([k, r]) => (
                    <Fragment key={k} label={k} value={`${r[0]} – ${r[1]}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// one case: how it did, where it missed, and what the report says about why
function CaseCard({ c, warn_c }: { c: ValidationCase; warn_c: number | null }) {
  const cov = c.coverage;
  const b = c.bands;
  const failed = c.passed === false;

  // The verdict is the word FAIL or PASS, in its own colour, one line down. A coloured
  // edge saying the same thing again is decoration.
  return (
    <div className="mt-1.5 rounded-lg border border-border-default bg-elevate-1 p-2.5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <span className={`text-xs font-semibold ${failed ? "text-status-red" : "text-status-green"}`}>
            {failed ? "FAIL" : "PASS"}
          </span>
          <span className="ml-2 text-xs text-text-primary">{c.name ?? c.case_id}</span>
        </div>
        <span className="text-[10px] text-text-muted tabular-nums">
          {c.case_id} · {c.kind} · cement {c.cement_type ?? "—"}
        </span>
      </div>

      {cov && (
        <div className="mt-1.5 flex items-baseline gap-3 text-[11px] tabular-nums flex-wrap">
          <span className={failed ? "text-status-red" : "text-status-green"}>
            {cov.pct_inside?.toFixed(0)}% inside the band
          </span>
          <span className="text-text-muted">
            {cov.n_inside} of {cov.n_checkpoints} checkpoint{cov.n_checkpoints === 1 ? "" : "s"}
          </span>
          {cov.inside && (
            <span className="flex flex-wrap gap-1">
              {cov.inside.map((ok, i) => (
                <Checkpoint key={i} inside={ok} at_h={b?.checkpoints_h?.[i]} index={i} />
              ))}
            </span>
          )}
        </div>
      )}

      {b && <CaseChart c={c} />}

      {/* the band width warning the report raises about its own evidence */}
      {b?.peak_width_c !== undefined && (
        <div className="mt-1.5 text-[10px] tabular-nums">
          <span className="text-text-muted">peak band width </span>
          <span className={c.band_too_wide ? "text-status-amber" : "text-text-secondary"}>
            {b.peak_width_c.toFixed(1)} °C
          </span>
          {c.band_too_wide && warn_c !== null && (
            <span className="text-status-amber">
              {" "}— wider than the {warn_c} °C warn threshold. The report flags this itself: a
              band this wide is too wide to be strong evidence either way, so covering a
              checkpoint with it proves little.
            </span>
          )}
          {b.peak_covered !== undefined && (
            <span className="text-text-muted"> · peak_covered {String(b.peak_covered)}</span>
          )}
        </div>
      )}

      {/* the errors, unrounded and unhidden */}
      {c.errors && (
        <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
          {Object.entries(c.errors).map(([k, v]) => (
            <Fragment
              key={k}
              label={k}
              value={Array.isArray(v) ? v.map((n) => n.toFixed(2)).join(", ") : v.toFixed(3)}
              warn={k.startsWith("max_abs")}
            />
          ))}
        </div>
      )}

      {c.notes && c.notes.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {c.notes.map((n, i) => (
            <li key={i} className="text-[10px] text-text-muted leading-relaxed pl-2 border-l border-border-strong">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// predicted band against what was actually measured, checkpoint by checkpoint
function CaseChart({ c }: { c: ValidationCase }) {
  const b = c.bands!;
  const p05 = b.p05 ?? [];
  const p50 = b.p50 ?? [];
  const p95 = b.p95 ?? [];
  const inside = c.coverage?.inside ?? [];
  const hours = b.checkpoints_h;
  // the measured values live under the band's own quantity name: a series for a field
  // case, a single scalar for the adiabatic one.
  const raw = b.quantity ? c.measured?.[b.quantity] : undefined;
  const measured: number[] =
    typeof raw === "number" ? [raw] : Array.isArray(raw) ? (raw as number[]) : [];
  const n = p50.length;
  if (n === 0) return null;

  const W = 560;
  const H = 118;
  const ML = 34;
  const MR = 8;
  const MT = 8;
  const MB = 18;

  const all = [...p05, ...p95, ...measured];
  const lo = Math.floor(Math.min(...all) / 10) * 10;
  const hi = Math.ceil(Math.max(...all) / 10) * 10;
  // equal spacing, not a time axis: 12/24/48/72/168 h on a real axis crushes the early
  // checkpoints into each other. The hour is printed under every tick.
  const x = (i: number) => (n === 1 ? (ML + W - MR) / 2 : ML + (i / (n - 1)) * (W - ML - MR));
  const y = (v: number) => MT + ((hi - v) / (hi - lo || 1)) * (H - MT - MB);

  const areaD =
    p95.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ") +
    " " +
    p05.map((_, i) => `L${x(n - 1 - i).toFixed(1)} ${y(p05[n - 1 - i]).toFixed(1)}`).join(" ") +
    " Z";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-1.5" style={{ height: 118 }} role="img" aria-label="Predicted band against measured checkpoints">
      <line x1={ML} y1={MT} x2={ML} y2={H - MB} stroke="rgba(240,246,252,0.25)" />
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} stroke="rgba(240,246,252,0.07)" />
          <text x={ML - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill="rgba(240,246,252,0.45)">{v}</text>
        </g>
      ))}
      <line x1={ML} y1={H - MB} x2={W - MR} y2={H - MB} stroke="rgba(240,246,252,0.25)" />

      {n > 1 ? (
        <>
          <path d={areaD} fill="#5d82e9" opacity={0.18} />
          <path d={p50.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ")} fill="none" stroke="#5d82e9" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <line x1={x(0)} y1={y(p05[0])} x2={x(0)} y2={y(p95[0])} stroke="#5d82e9" strokeWidth="8" opacity={0.3} />
          <circle cx={x(0)} cy={y(p50[0])} r="3" fill="#5d82e9" />
        </>
      )}

      {measured.map((m, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(m)} r="3.5" fill={inside[i] ? "#00a99c" : "#e5484d"} stroke="#0a0b0c" strokeWidth="1" />
          <text x={x(i)} y={y(m) - 6} textAnchor="middle" fontSize="8" fill={inside[i] ? "#00a99c" : "#e5484d"} className="tabular-nums">
            {m.toFixed(1)}
          </text>
        </g>
      ))}

      {p50.map((_, i) => (
        <text key={i} x={x(i)} y={H - MB + 12} textAnchor="middle" fontSize="8" fill="rgba(240,246,252,0.45)">
          {hours ? `${hours[i]}h` : b.quantity}
        </text>
      ))}
    </svg>
  );
}

function Fragment({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className={`${warn ? "text-status-amber" : "text-text-secondary"} text-right break-all`}>
        {value}
      </span>
    </>
  );
}

