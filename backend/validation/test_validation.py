"""Run every case against its stated acceptance criteria and write the report.

These are NOT unit tests and they are excluded from the default suite - pyproject sets
testpaths to tests/, so `pytest` does not collect this file. Run it deliberately:

    pytest validation/ -m validation

A case that misses is a real failure and is left red on purpose. The acceptance numbers
come from docs/VALIDATION-CASES.md and must not be widened to make the bar clear.
"""

import pytest

from validation.report import write_report
from validation.runner import CaseResult, run_all

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
    assert "Limitations" in markdown_path.read_text()


@pytest.mark.parametrize("case_id", ["deer_creek_adiabatic", "stony_gorge_2008",
                                     "deer_creek_p4_2008"])
def test_case_meets_acceptance(results: list[CaseResult], case_id: str) -> None:
    result = next(r for r in results if r.case_id == case_id)
    failed = [name for name, ok in result.passed.items() if not ok]
    assert not failed, (
        f"{case_id} missed: {failed}. Errors: "
        f"{ {k: v for k, v in result.errors.items()} }"
    )
