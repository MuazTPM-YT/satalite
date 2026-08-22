"""Write docs/VALIDATION.md and docs/VALIDATION.json from a validation run.

Every case that was run appears, passing or not. A validation page that only lists the
cases that matched is worth less than no validation page at all, because it teaches a
reader to trust numbers that were never tested.
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from validation.runner import CaseResult, run_all

DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"
MARKDOWN_PATH = DOCS_DIR / "VALIDATION.md"
JSON_PATH = DOCS_DIR / "VALIDATION.json"

LIMITATIONS = [
    "Ambient temperature is a Parton-Logan reconstruction from the reported multi-day "
    "average and maximum. No hourly series exists in the source. The daily minimum is "
    "inferred as 2*mean - max, forcing a symmetric diurnal swing that real weather does "
    "not have.",
    "Humidity, wind, cloud cover and irradiance are not reported and are held at fixed "
    "assumed values (see validation/runner.py). They are not measurements.",
    "Cement chemistry - C3A, C3S, SO3 and Blaine fineness - is NOT reported in DSO-12-02. "
    "The values in the case files are assumed for an ordinary Type II clinker. The "
    "Schindler-Folliard tau regression is highly sensitive to them: tau moves from 25.8 h "
    "to 15.2 h across a plausible SO3 range alone, and tau sets the whole early-age shape.",
    "Silica fume carries no term in the Schindler-Folliard ultimate-heat formula, so the "
    "Deer Creek mix has 27.3 kg/m3 of unmodelled binder. This biases predictions LOW.",
    "The solver is 2D. Both field elements are finite in the third dimension, so the real "
    "sections lose heat this model cannot.",
    "Strength is not validated here. Case 4 of the source (Table 9) needs a calibrated "
    "strength-maturity model; physics/strength_model.py is PROVISIONAL.",
]


# a signed error with its sign spelled out, so nobody has to guess the convention.
def _fmt(value: float | None, unit: str = "") -> str:
    if value is None:
        return "n/a"
    return f"{value:+.1f}{unit}"


# one case as a markdown section.
def _case_markdown(result: CaseResult) -> str:
    verdict = "PASS" if result.all_passed else "FAIL"
    lines = [
        f"## {result.name}",
        "",
        f"**Case id:** `{result.case_id}` &nbsp;|&nbsp; **Kind:** {result.kind} "
        f"&nbsp;|&nbsp; **Verdict: {verdict}**",
        "",
    ]

    checks = ", ".join(
        f"{name} {'pass' if ok else 'FAIL'}" for name, ok in sorted(result.passed.items())
    )
    lines += [f"Checks: {checks}", ""]

    if result.kind == "adiabatic":
        lines += [
            "| Quantity | Predicted | Measured | Error |",
            "|---|---|---|---|",
            f"| Adiabatic rise | {result.predicted['adiabatic_rise_c']:.1f} °C "
            f"({result.predicted['adiabatic_rise_c'] * 9 / 5:.1f} °F) | "
            f"{result.measured['adiabatic_rise_c']:.1f} °C "
            f"({result.measured['adiabatic_rise_c'] * 9 / 5:.1f} °F) | "
            f"{_fmt(result.errors['adiabatic_rise_pct'], ' %')} |",
            f"| Peak temperature | {result.predicted['peak_temp_c']:.1f} °C | "
            f"{result.measured['peak_temp_c']:.1f} °C | "
            f"{_fmt(result.predicted['peak_temp_c'] - result.measured['peak_temp_c'], ' °C')} |",
            "",
        ]
    else:
        lines += ["| Checkpoint | Predicted °C | Measured °C | Error °C |", "|---|---|---|---|"]
        for hour, pred, meas, err in zip(
            result.predicted["checkpoints_h"],
            result.predicted["core_temp_c"],
            result.measured["core_temp_c"],
            result.errors["checkpoint_c"],
            strict=True,
        ):
            lines.append(f"| {hour:.0f} h | {pred:.1f} | {meas:.1f} | {_fmt(err)} |")
        lines += [
            f"| **Peak core** | {result.predicted['peak_core_temp_c']:.1f} | "
            f"{result.measured['peak_core_temp_c']:.1f} | "
            f"{_fmt(result.errors['peak_core_temp_c'])} |",
            "",
            f"Predicted peak at {result.predicted['peak_core_time_h']:.1f} h; measured "
            f"window {result.measured['peak_time_window_h'] or 'not reported'}. "
            f"Time error {_fmt(result.errors['peak_core_time_h'], ' h')}.",
            "",
        ]

    lines += [
        "Derived mix parameters (not tuned - straight out of the Schindler-Folliard "
        f"regressions): alpha_u = {result.predicted['alpha_u']:.3f}, "
        f"H_u = {result.predicted['h_u_j_per_kg']:.0f} J/kg, "
        f"tau = {result.predicted['tau_h']:.1f} h.",
        "",
    ]
    if result.notes:
        lines += ["Case notes:", ""] + [f"- {note}" for note in result.notes] + [""]
    return "\n".join(lines)


# the whole report, failures and all.
def to_markdown(results: list[CaseResult], generated_at: str) -> str:
    n_pass = sum(r.all_passed for r in results)
    header = [
        "# SatAlite — Validation",
        "",
        f"Generated {generated_at} by `pytest validation/ -m validation`.",
        "",
        f"**{n_pass} of {len(results)} cases pass their stated acceptance criteria.**",
        "",
        "Source: USBR DSO-12-02, *Thermal Properties of Reinforced Structural Mass "
        "Concrete*, Bartojay 2012. Every measured value is transcribed from a table in "
        "that report; nothing is digitized from a chart and nothing is fitted.",
        "",
        "Error sign convention: **predicted minus measured**. Positive means the model "
        "ran hot.",
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
        "cases": [
            {
                "case_id": r.case_id,
                "name": r.name,
                "kind": r.kind,
                "passed": r.all_passed,
                "checks": r.passed,
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
