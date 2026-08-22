"""Write docs/VALIDATION.md and docs/VALIDATION.json from a validation run.

Every case that was run appears, passing or not. A validation page that only lists the
cases that matched is worth less than no validation page at all, because it teaches a
reader to trust numbers that were never tested.

Coverage is the headline. Point error is printed underneath it, smaller, because against
a cement whose chemistry was never published a point prediction is a test of guesses.
A case whose band is too wide to be informative is labelled as such next to its coverage,
so a 100% coverage that was bought with a 40 C band cannot be quoted as a success.
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from validation.runner import (
    ASSUMED_CHEMISTRY_RANGES,
    BAND_WIDTH_WARN_C,
    COVERAGE_PASS_PCT,
    N_SAMPLES,
    CaseResult,
    run_all,
)

DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"
MARKDOWN_PATH = DOCS_DIR / "VALIDATION.md"
JSON_PATH = DOCS_DIR / "VALIDATION.json"

LIMITATIONS = [
    "Cement chemistry — C3A, C3S, SO3 and Blaine fineness — is NOT reported in "
    "DSO-12-02. This is why the test is coverage and not point error. The ranges "
    "sampled are typical published ASTM C150 ranges for the stated cement type; they "
    "are ASSUMPTIONS, not measurements, and they were not narrowed or re-centred to "
    "make any case pass. The Schindler-Folliard tau regression is highly sensitive to "
    "them: tau moves from 25.8 h to 15.2 h across a plausible SO3 range alone.",
    "Coverage is conditional on the reconstructed ambient. Ambient temperature is a "
    "Parton-Logan reconstruction from the reported multi-day average and maximum. No "
    "hourly series exists in the source. The daily minimum is inferred as 2*mean - max, "
    "forcing a symmetric diurnal swing that real weather does not have. This "
    "reconstruction is NOT varied by the ensemble, so its error sits OUTSIDE the band.",
    "Humidity, wind, cloud cover and irradiance are not reported and are held at fixed "
    "assumed values (see validation/runner.py). They are not measurements, and they are "
    "not varied by the ensemble either.",
    "Silica fume carries no term in the Schindler-Folliard ultimate-heat formula, so the "
    "Deer Creek mix has 27.3 kg/m3 of unmodelled binder. This biases the prediction LOW. "
    "Deer Creek already over-predicts, so the TRUE over-prediction is worse than the "
    "number reported here — a term for silica fume would push the band further above the "
    "measurements, not toward them. No such term has been invented to close the gap.",
    "H_cem is selected by ASTM cement type (physics.constants.H_CEM_BY_TYPE: I 510, "
    "II 500, II/V 470, V 450 J/g) rather than computed from Bogue compounds, because "
    "DSO-12-02 publishes no oxide analysis. The type means are literature values; only "
    "the Type II figure is confirmed against a measurement in these cases.",
    "The ensemble varies the mix, the surface film, the solar absorptivity, the "
    "placement temperature and the activation energy. It does not vary the geometry, "
    "the formwork R-value or the weather reconstruction. Those errors are outside the "
    "band.",
    "The solver is 2D. Both field elements are finite in the third dimension, so the "
    "real sections lose heat this model cannot.",
    "Strength is not validated here. Case 4 of the source (Table 9) needs a calibrated "
    "strength-maturity model; physics/strength_model.py is PROVISIONAL.",
]


# a signed error with its sign spelled out, so nobody has to guess the convention.
def _fmt(value: float | None, unit: str = "") -> str:
    if value is None:
        return "n/a"
    return f"{value:+.1f}{unit}"


# coverage headline plus the width caveat that stops a vacuous band reading as a win.
def _coverage_lines(result: CaseResult) -> list[str]:
    coverage = result.coverage
    verdict = "PASS" if result.all_passed else "FAIL"
    lines = [
        f"**Coverage: {coverage['pct_inside']:.0f}%** "
        f"({coverage['n_inside']} of {coverage['n_checkpoints']} measured checkpoints "
        f"inside p05–p95) &nbsp;|&nbsp; **{verdict}** at the "
        f"{COVERAGE_PASS_PCT:.0f}% bar.",
        "",
        f"Peak band width p95−p05: **{result.bands['peak_width_c']:.1f} °C**.",
        "",
    ]
    if result.band_too_wide:
        lines += [
            f"> ⚠️ **This band is too wide to be evidence.** {result.bands['peak_width_c']:.1f} °C "
            f"at the peak exceeds the {BAND_WIDTH_WARN_C:.0f} °C limit, so it would contain "
            "most plausible outcomes whatever the model did. Read the coverage above as "
            "*not falsified*, not as *confirmed*.",
            "",
        ]
    return lines


# the assumed ranges, printed per case so nobody has to open the source to see them.
def _ranges_markdown(result: CaseResult) -> list[str]:
    pretty = ", ".join(
        f"{name} {low:g}–{high:g}" for name, (low, high) in sorted(result.chemistry_ranges.items())
    )
    return [
        f"Cement type **{result.cement_type}**, H_cem "
        f"{result.predicted['h_cem_j_per_g']:.0f} J/g. ASSUMED chemistry ranges sampled "
        f"({N_SAMPLES} draws): {pretty}. These are typical ASTM C150 ranges for the type, "
        "**not measured values**, and they are not tuned.",
        "",
        f"Resulting tau: p05 {result.predicted['tau_h_p05']:.1f} h, "
        f"p50 {result.predicted['tau_h_p50']:.1f} h, "
        f"p95 {result.predicted['tau_h_p95']:.1f} h.",
        "",
    ]


# one case as a markdown section.
def _case_markdown(result: CaseResult) -> str:
    lines = [
        f"## {result.name}",
        "",
        f"**Case id:** `{result.case_id}` &nbsp;|&nbsp; **Kind:** {result.kind}",
        "",
    ] + _coverage_lines(result) + _ranges_markdown(result)

    if result.kind == "adiabatic":
        lines += [
            "| Quantity | p05 | p50 | p95 | Measured | Covered |",
            "|---|---|---|---|---|---|",
            f"| Adiabatic rise °C | {result.bands['p05'][0]:.1f} | "
            f"{result.bands['p50'][0]:.1f} | {result.bands['p95'][0]:.1f} | "
            f"{result.measured['adiabatic_rise_c']:.1f} | "
            f"{'yes' if result.coverage['inside'][0] else 'NO'} |",
            "",
            "Secondary — point error on the ensemble median: "
            f"{_fmt(result.errors['adiabatic_rise_c'], ' °C')} "
            f"({_fmt(result.errors['adiabatic_rise_pct'], ' %')}).",
            "",
        ]
    else:
        lines += [
            "| Checkpoint | p05 °C | p50 °C | p95 °C | Measured °C | Covered |",
            "|---|---|---|---|---|---|",
        ]
        for hour, low, mid, high, meas, ok in zip(
            result.bands["checkpoints_h"],
            result.bands["p05"],
            result.bands["p50"],
            result.bands["p95"],
            result.measured["core_temp_c"],
            result.coverage["inside"],
            strict=True,
        ):
            lines.append(
                f"| {hour:.0f} h | {low:.1f} | {mid:.1f} | {high:.1f} | {meas:.1f} | "
                f"{'yes' if ok else 'NO'} |"
            )
        lines += [
            f"| **Peak core** | {result.bands['peak_p05']:.1f} | "
            f"{result.bands['peak_p50']:.1f} | {result.bands['peak_p95']:.1f} | "
            f"{result.measured['peak_core_temp_c']:.1f} | "
            f"{'yes' if result.bands['peak_covered'] else 'NO'} |",
            "",
            "Secondary — point error on the ensemble median: peak "
            f"{_fmt(result.errors['peak_core_temp_c'], ' °C')}, worst checkpoint "
            f"{result.errors['max_abs_checkpoint_c']:.1f} °C.",
            "",
        ]

    lines += [
        "Derived mix parameters (not tuned — straight out of the Schindler-Folliard "
        f"regressions): alpha_u = {result.predicted['alpha_u']:.3f}, "
        f"H_u = {result.predicted['h_u_j_per_kg']:.0f} J/kg.",
        "",
    ]
    if result.notes:
        lines += ["Case notes:", ""] + [f"- {note}" for note in result.notes] + [""]
    return "\n".join(lines)


# the whole report, failures and all.
def to_markdown(results: list[CaseResult], generated_at: str) -> str:
    n_pass = sum(r.all_passed for r in results)
    n_wide = sum(r.band_too_wide for r in results)
    header = [
        "# SatAlite — Validation",
        "",
        f"Generated {generated_at} by `pytest validation/ -m validation`.",
        "",
        f"**{n_pass} of {len(results)} cases meet the {COVERAGE_PASS_PCT:.0f}% coverage "
        "bar.**",
        "",
        "The metric is **coverage**: the fraction of measured checkpoints that fall "
        f"inside the p05–p95 band of a {N_SAMPLES}-sample Monte Carlo. It is not a point "
        "prediction, and that is deliberate. DSO-12-02 never publishes C3A, C3S, SO3 or "
        "Blaine for either cement, so a point prediction would be a test of four numbers "
        "nobody measured. What is testable is whether the published range of chemistries "
        "for the stated cement type contains what actually happened.",
        "",
        "Point error against the ensemble median is reported under each case as a "
        "**secondary** metric. Sign convention: **predicted minus measured**, so positive "
        "means the model ran hot.",
        "",
    ]
    if n_wide:
        header += [
            f"> ⚠️ **{n_wide} of {len(results)} cases have a peak band wider than "
            f"{BAND_WIDTH_WARN_C:.0f} °C.** A band that wide contains almost any outcome, "
            "so its coverage is weak evidence at best. Those cases are flagged inline.",
            "",
        ]
    header += [
        "Source: USBR DSO-12-02, *Thermal Properties of Reinforced Structural Mass "
        "Concrete*, Bartojay 2012. Every measured value is transcribed from a table in "
        "that report; nothing is digitized from a chart and nothing is fitted.",
        "",
        "---",
        "",
    ]
    sections = [_case_markdown(r) for r in results]
    limitations = [
        "---",
        "",
        "## Limitations — read before quoting any number above",
        "",
    ] + [f"{i}. {text}" for i, text in enumerate(LIMITATIONS, start=1)] + [""]
    return "\n".join(header + sections + limitations)


# the machine-readable twin, which /api/validation serves.
def to_json(results: list[CaseResult], generated_at: str) -> dict[str, Any]:
    return {
        "generated_at": generated_at,
        "primary_metric": "coverage_pct",
        "coverage_pass_pct": COVERAGE_PASS_PCT,
        "band_width_warn_c": BAND_WIDTH_WARN_C,
        "n_samples": N_SAMPLES,
        "assumed_chemistry_ranges": {
            cement_type: {name: list(bounds) for name, bounds in ranges.items()}
            for cement_type, ranges in ASSUMED_CHEMISTRY_RANGES.items()
        },
        "cases": [
            {
                "case_id": r.case_id,
                "name": r.name,
                "kind": r.kind,
                "cement_type": r.cement_type,
                "passed": r.all_passed,
                "checks": r.passed,
                "coverage": r.coverage,
                "bands": r.bands,
                "band_too_wide": r.band_too_wide,
                "predicted": r.predicted,
                "measured": r.measured,
                "errors": r.errors,
                "notes": r.notes,
            }
            for r in results
        ],
        "notes": LIMITATIONS,
    }


# run everything and write both files.
def write_report(results: list[CaseResult] | None = None) -> tuple[Path, Path]:
    results = results if results is not None else run_all()
    generated_at = datetime.now(UTC).isoformat(timespec="seconds")

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    MARKDOWN_PATH.write_text(to_markdown(results, generated_at))
    JSON_PATH.write_text(json.dumps(to_json(results, generated_at), indent=1))
    return MARKDOWN_PATH, JSON_PATH


if __name__ == "__main__":
    for path in write_report():
        print(f"wrote {path}")
