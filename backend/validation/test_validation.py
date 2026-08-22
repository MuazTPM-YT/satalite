"""Run every case as an ensemble, check coverage, and write the report.

These are NOT unit tests and they are excluded from the default suite - pyproject sets
testpaths to tests/, so `pytest` does not collect this file. Run it deliberately:

    pytest validation/ -m validation

A case that misses is a real failure and is left red on purpose. The acceptance bar is
coverage >= COVERAGE_PASS_PCT and it must not be lowered to make a case clear, any more
than the chemistry ranges may be narrowed to do the same job.
"""

import pytest

from validation.report import write_report
from validation.runner import (
    ASSUMED_CHEMISTRY_RANGES,
    COVERAGE_PASS_PCT,
    CaseResult,
    run_all,
)

pytestmark = pytest.mark.validation


@pytest.fixture(scope="module")
def results() -> list[CaseResult]:
    return run_all()


def test_every_case_loads_and_runs(results: list[CaseResult]) -> None:
    assert len(results) == 3, "expected the three USBR DSO-12-02 cases"


# the report must exist whether or not the cases pass. failures are the point of it.
def test_report_is_written(results: list[CaseResult]) -> None:
    markdown_path, json_path = write_report(results)
    assert markdown_path.exists() and json_path.exists()
    text = markdown_path.read_text()
    assert "Limitations" in text
    assert "Coverage" in text
    # the assumed ranges must be visible in the report, not buried in the source
    assert "ASSUMED chemistry ranges" in text


# the published ranges are the input to the test. Narrowing one to make a case pass
# would be tuning, so their bounds are pinned here where a diff is obvious.
def test_chemistry_ranges_are_the_published_ones() -> None:
    assert ASSUMED_CHEMISTRY_RANGES["II"] == {
        "c3a_frac": (0.05, 0.08),
        "c3s_frac": (0.50, 0.60),
        "so3_frac": (0.025, 0.035),
        "blaine_m2_kg": (340.0, 400.0),
    }
    assert ASSUMED_CHEMISTRY_RANGES["II/V"] == {
        "c3a_frac": (0.03, 0.05),
        "c3s_frac": (0.50, 0.60),
        "so3_frac": (0.020, 0.030),
        "blaine_m2_kg": (330.0, 390.0),
    }


# A band wide enough to contain anything is not a result. The stated acceptance bar is
# coverage, so width is NOT a pass/fail gate - but it must never be silently omitted,
# because a wide band plus a green tick is exactly how a vacuous result gets quoted.
# This test therefore checks the warning reaches the reader, not that the band is narrow.
def test_a_wide_band_is_reported_as_such(results: list[CaseResult]) -> None:
    wide = [r for r in results if r.band_too_wide]
    if not wide:
        pytest.skip("no case exceeded the width limit on this run")
    markdown_path, _ = write_report(results)
    text = markdown_path.read_text()
    assert "too wide to be evidence" in text
    for result in wide:
        assert f"{result.bands['peak_width_c']:.1f} °C" in text, (
            f"{result.case_id} band width missing from the report"
        )


@pytest.mark.parametrize("case_id", ["deer_creek_adiabatic", "stony_gorge_2008",
                                     "deer_creek_p4_2008"])
def test_case_is_covered_by_its_band(results: list[CaseResult], case_id: str) -> None:
    result = next(r for r in results if r.case_id == case_id)
    assert result.coverage["pct_inside"] >= COVERAGE_PASS_PCT, (
        f"{case_id} coverage {result.coverage['pct_inside']:.0f}% is below the "
        f"{COVERAGE_PASS_PCT:.0f}% bar. Inside: {result.coverage['inside']}. "
        f"Peak band p05-p95 width {result.bands['peak_width_c']:.1f} C. "
        f"Median point errors: {result.errors}"
    )
