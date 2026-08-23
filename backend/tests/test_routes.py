"""The API boundary: validation rejects bad input, and precomputed routes never compute."""

import json
from pathlib import Path

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
        "ensemble": True,
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


# the sweep is what the route is for. A minute of ensemble on a request thread is a
# gateway timeout on a free tier, so it must not happen unless it was asked for.
def test_pour_windows_leaves_the_ensemble_off_unless_asked(client: TestClient) -> None:
    body = {
        "element": ELEMENT,
        "ambient": ambient_payload(),
        "candidate_offsets_h": [0.0, 4.0],
        "duration_hours": 6.0,
    }
    resp = client.post("/api/pour-windows", json=body)
    assert resp.status_code == 200, resp.text
    assert resp.json()["ensemble"] is None
    assert len(resp.json()["candidates"]) == 2


# a missing season degrades to available=false, never a 503 and never a fake payload
def test_season_analysis_missing_says_how_to_build_it(client: TestClient) -> None:
    resp = client.get("/api/season-analysis")
    # degrades, never 503: a dead endpoint in a live demo reads as a broken backend.
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is False
    assert body["n_days"] is None
    assert "fetch_season" in body["detail"]


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
    assert resp.json()["available"] is True


def _demo_ensemble_payload() -> dict[str, object]:
    bands = {key: [1.0, 2.0] for key in ("p05", "p25", "p50", "p75", "p95")}
    return {
        "scenario": {
            "element": ELEMENT,
            "ambient": ambient_payload(),
            "duration_hours": 6.0,
        },
        "ensemble": {
            "n_samples": 2048,
            "seed": 0,
            "dx_m": 0.02,
            "core_temp_c": bands,
            "surface_temp_c": bands,
            "strength_fraction": bands,
            "equivalent_age_h": bands,
            "strength_probability": [0.0, 1.0],
            "strip_time_h_p95": 30.0,
            "forecast_error": {"provisional": True},
        },
        "built_at": "2026-08-23T00:00:00+00:00",
        "sampler": "scipy.stats.qmc.Sobol(scramble=True)",
        "dt_s": 30.0,
        "sampled_parameters": ["tau_h"],
        "note": "one fixed scenario",
    }


def test_demo_ensemble_missing_says_how_to_build_it(client: TestClient) -> None:
    resp = client.get("/api/demo-ensemble")
    assert resp.status_code == 503
    assert "build_demo_ensemble" in resp.json()["detail"]


# the served band must carry the scenario it was computed for. A cached band drawn
# beside a different pour is worse than showing no band at all.
def test_demo_ensemble_serves_the_band_with_its_scenario(client: TestClient) -> None:
    path = get_settings().cache_dir / "demo-ensemble.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_demo_ensemble_payload()))

    resp = client.get("/api/demo-ensemble")
    assert resp.status_code == 200, resp.text

    data = resp.json()
    assert data["ensemble"]["n_samples"] == 2048
    assert data["scenario"]["element"]["shape"] == ELEMENT["shape"]
    assert data["scenario"]["duration_hours"] == 6.0
    assert data["sampled_parameters"] == ["tau_h"]


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


# the report path used to be a fixed count of parents up from __file__, which lands
# outside the container's flattened layout and 503s there for the wrong reason.
def test_validation_path_is_a_setting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VALIDATION_PATH", str(tmp_path / "nowhere.json"))
    get_settings.cache_clear()

    resp = TestClient(create_app()).get("/api/validation")
    assert resp.status_code == 503
    assert "nowhere.json" in resp.json()["detail"]


# the origin list defaults to localhost, so a deployment that forgets it passes every
# test and then fails every browser request. Prove the setting reaches the middleware.
def test_allowed_origins_comes_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://satalite.example.com,http://localhost:3000")
    get_settings.cache_clear()

    client = TestClient(create_app())
    deployed = client.get("/api/health", headers={"Origin": "https://satalite.example.com"})
    assert deployed.headers["access-control-allow-origin"] == "https://satalite.example.com"

    stranger = client.get("/api/health", headers={"Origin": "https://not-ours.example.com"})
    assert "access-control-allow-origin" not in stranger.headers
