"""The API boundary: validation rejects bad input, and precomputed routes never compute."""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app

HOURS = 13


def ambient_payload(air_temp_c: float = 30.0) -> dict[str, object]:
    return {
        "hours_h": list(range(HOURS)),
        "air_temp_c": [air_temp_c] * HOURS,
        "rh_frac": [0.3] * HOURS,
        "wind_ms": [2.0] * HOURS,
        "cloud_pct": [10.0] * HOURS,
        "ghi_w_m2": [0.0] * HOURS,
    }


ELEMENT = {
    "shape": "slab",
    "dims_mm": {"width": 400.0, "thickness": 300.0},
    "dx_m": 0.04,
    "placement_temp_c": 25.0,
}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_simulate_returns_a_full_history(client: TestClient) -> None:
    body = {"element": ELEMENT, "ambient": ambient_payload(), "duration_hours": 6.0}
    resp = client.post("/api/simulate", json=body)
    assert resp.status_code == 200, resp.text

    data = resp.json()
    assert len(data["times_h"]) == len(data["core_temp_c"]) == len(data["strength_fraction"])
    assert data["ensemble"] is None
    # equivalent age only accumulates
    assert np.all(np.diff(data["equivalent_age_h"]) >= 0.0)
    # every breach flag arrives with the threshold it was tested against
    assert data["breaches"]["def_threshold_c"] == 68.3
    assert data["breaches"]["cracking_limit_c"] == 19.4


def test_simulate_with_ensemble_adds_ordered_bands(client: TestClient) -> None:
    body = {"element": ELEMENT, "ambient": ambient_payload(), "duration_hours": 6.0}
    resp = client.post("/api/simulate?ensemble=true&samples=8&seed=0", json=body)
    assert resp.status_code == 200, resp.text

    ensemble = resp.json()["ensemble"]
    assert ensemble["n_samples"] == 8
    assert ensemble["seed"] == 0
    assert ensemble["dx_m"] == 0.02
    bands = ensemble["core_temp_c"]
    stacked = np.asarray([bands[k] for k in ("p05", "p25", "p50", "p75", "p95")])
    assert np.all(np.diff(stacked, axis=0) >= -1e-9)
    # the caller must be able to see the forecast skill is not measured yet
    assert ensemble["forecast_error"]["provisional"] is True


# same seed, same answer, or the demo is not reproducible
def test_simulate_ensemble_is_reproducible(client: TestClient) -> None:
    body = {"element": ELEMENT, "ambient": ambient_payload(), "duration_hours": 6.0}
    url = "/api/simulate?ensemble=true&samples=6&seed=3"
    first = client.post(url, json=body).json()["ensemble"]["core_temp_c"]
    second = client.post(url, json=body).json()["ensemble"]["core_temp_c"]
    assert first == second


def test_ragged_ambient_is_rejected_at_the_boundary(client: TestClient) -> None:
    bad = ambient_payload()
    bad["wind_ms"] = [2.0]
    resp = client.post("/api/simulate", json={"element": ELEMENT, "ambient": bad})
    assert resp.status_code == 422
    assert "length" in resp.text


def test_unknown_shape_is_rejected(client: TestClient) -> None:
    resp = client.post(
        "/api/simulate",
        json={"element": {**ELEMENT, "shape": "hyperboloid"}, "ambient": ambient_payload()},
    )
    assert resp.status_code == 422


def test_unknown_mix_id_is_rejected_not_silently_defaulted(client: TestClient) -> None:
    resp = client.post(
        "/api/simulate",
        json={
            "element": ELEMENT,
            "mix": {"mix_id": "made-up"},
            "ambient": ambient_payload(),
        },
    )
    assert resp.status_code == 422
    assert "made-up" in resp.text


def test_pour_windows_ranks_candidates_and_ensembles_the_pick(client: TestClient) -> None:
    body = {
        "element": ELEMENT,
        "ambient": ambient_payload(),
        "candidate_offsets_h": [0.0, 4.0],
        "duration_hours": 6.0,
        "ensemble_samples": 6,
    }
    resp = client.post("/api/pour-windows", json=body)
    assert resp.status_code == 200, resp.text

    data = resp.json()
    assert len(data["candidates"]) == 2
    assert data["best_offset_h"] in (0.0, 4.0)
    assert data["ensemble"]["n_samples"] == 6
    # the pick must actually be the best-ranked candidate, not just the first
    best = min(data["candidates"], key=lambda c: (c["n_breaches"], c["peak_core_temp_c"]))
    assert data["best_offset_h"] == best["offset_h"]


# a missing precompute is a 503 that says how to build it, never a fabricated payload
def test_season_analysis_missing_says_how_to_build_it(client: TestClient) -> None:
    resp = client.get("/api/season-analysis")
    assert resp.status_code == 503
    assert "fetch_season" in resp.json()["detail"]


def test_season_analysis_serves_the_precomputed_file(client: TestClient) -> None:
    payload = {
        "n_days": 2,
        "date_range": ["2025-06-01", "2025-06-02"],
        "placement_hours": [4, 14],
        "per_placement_hour": {"4": {"pct_days_breaching_def": 0.0}},
        "delta_14_minus_04": {"mean_peak_core_temp_c": 7.8},
        "element": {"fixed_on": "2026-08-22"},
        "limits": {"def_c": 68.3},
        "assumptions": {"note": "not measured"},
    }
    path = get_settings().cache_dir / "season-analysis.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))

    resp = client.get("/api/season-analysis")
    assert resp.status_code == 200
    assert resp.json()["n_days"] == 2


# 200 once `pytest validation/ -m validation` has written the report, 503 before that.
# Either is correct; a fabricated payload never is.
def test_validation_serves_the_report_or_says_how_to_build_it(client: TestClient) -> None:
    resp = client.get("/api/validation")
    if resp.status_code == 503:
        assert "validation" in resp.json()["detail"]
        return

    assert resp.status_code == 200
    cases = resp.json()["cases"]
    assert {c["case_id"] for c in cases} == {
        "deer_creek_adiabatic",
        "stony_gorge_2008",
        "deer_creek_p4_2008",
    }
    # failures must be served too, not filtered out
    assert any(c["passed"] is False for c in cases)
    assert resp.json()["notes"], "limitations must travel with the numbers"
