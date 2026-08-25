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


def test_on_ground_is_refused_rather_than_solved_with_an_insulated_base(
    client: TestClient,
) -> None:
    resp = client.post(
        "/api/simulate",
        json={"element": {**ELEMENT, "on_ground": True}, "ambient": ambient_payload()},
    )
    assert resp.status_code == 422
    assert "ground boundary not modelled" in resp.text
    # the pour-window route shares the same ElementSpec, so it must refuse too
    resp = client.post(
        "/api/pour-windows",
        json={
            "element": {**ELEMENT, "on_ground": True},
            "ambient": ambient_payload(),
            "candidate_offsets_h": [0.0],
        },
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


# master 4.4: T_ref is a config value, never silently hardcoded. It has to be reachable
# from a request AND visible on the response, because a run integrated at 20 C read
# against strength parameters fitted at 23 C is an offset nobody can see.
def test_t_ref_c_is_reachable_and_echoed_in_run_metadata(client: TestClient) -> None:
    body = {"element": ELEMENT, "ambient": ambient_payload(), "duration_hours": 6.0}
    default = client.post("/api/simulate", json=body).json()
    assert default["t_ref_c"] == 20.0

    raised = client.post("/api/simulate", json={**body, "t_ref_c": 23.0}).json()
    assert raised["t_ref_c"] == 23.0
    # a higher reference means every hour counts for less, so equivalent age must fall
    assert raised["equivalent_age_h"][-1] < default["equivalent_age_h"][-1]


def test_t_ref_c_outside_the_physical_range_is_rejected(client: TestClient) -> None:
    body = {"element": ELEMENT, "ambient": ambient_payload(), "t_ref_c": 0.0}
    assert client.post("/api/simulate", json=body).status_code == 422


def test_simulate_omits_the_field_unless_asked(client: TestClient) -> None:
    body = {"element": ELEMENT, "ambient": ambient_payload(), "duration_hours": 6.0}
    resp = client.post("/api/simulate", json=body)
    assert resp.status_code == 200, resp.text
    assert resp.json()["fields"] is None


def test_simulate_fields_thin_frames_but_never_cells(client: TestClient) -> None:
    body = {"element": ELEMENT, "ambient": ambient_payload(), "duration_hours": 6.0}
    full = client.post("/api/simulate", json=body).json()
    resp = client.post("/api/simulate?fields=true&fields_stride_h=1.0", json=body)
    assert resp.status_code == 200, resp.text

    fields = resp.json()["fields"]
    # the frame axis is thinned, so there are fewer frames than recorded steps
    assert len(fields["times_h"]) < len(full["times_h"])
    assert len(fields["temp_c"]) == len(fields["times_h"]) == len(fields["frame_indices"])
    # x and y are NOT resampled: every kept frame is the full solved grid
    for frame in fields["temp_c"]:
        assert len(frame) == fields["ny"]
        assert all(len(row) == fields["nx"] for row in frame)
    # frame_indices really do index the full series
    for k, i in enumerate(fields["frame_indices"]):
        assert fields["times_h"][k] == pytest.approx(full["times_h"][i])
    # the peak-core frame survives any stride, or peak_core_temp_c stops being
    # reproducible from the field it was sampled out of
    peak_i = int(np.argmax(full["core_temp_c"]))
    assert peak_i in fields["frame_indices"]


def test_simulate_fields_leave_holes_null_not_filled(client: TestClient) -> None:
    # a T carries a hole in its bounding box. Those cells hold no concrete, so they must
    # come back null - a number there reads as concrete sitting at that temperature.
    element = {
        "shape": "t_section",
        "dims_mm": {
            "flange_width": 600.0,
            "flange_thickness": 150.0,
            "web_width": 200.0,
            "height": 500.0,
        },
        "dx_m": 0.05,
        "placement_temp_c": 25.0,
    }
    body = {"element": element, "ambient": ambient_payload(), "duration_hours": 2.0}
    resp = client.post("/api/simulate?fields=true", json=body)
    assert resp.status_code == 200, resp.text

    frame = resp.json()["fields"]["temp_c"][0]
    flat = [v for row in frame for v in row]
    assert None in flat, "the notch outside the T must be null"
    assert any(v is not None for v in flat), "the concrete must carry temperatures"


# ---------------------------------------------------------------------------
# Location: US-only coverage, the credit gate, and latitude actually arriving
# ---------------------------------------------------------------------------
# Phoenix on the demo day is the one site-day that is committed to the cache, so it is
# the only one these tests may ask the /ambient route to build. Everything else is
# checked through /ambient/quote, which never calls the API and never spends.
PHOENIX = {"lat": 33.45, "lon": -112.07}
CACHED_DAY = "2025-07-15"


def test_non_us_coordinates_are_refused_before_any_call(client: TestClient) -> None:
    # Dubai. The failure a judge must never see is a stack trace out of the vendored
    # client, so this has to be refused at the boundary with a sentence.
    resp = client.post(
        "/api/ambient", json={"lat": 25.2, "lon": 55.27, "date": CACHED_DAY}
    )
    assert resp.status_code == 422, resp.text
    assert "United States only" in resp.json()["detail"]


def test_quote_reports_out_of_coverage_without_raising(client: TestClient) -> None:
    # the picker asks this on every keystroke, so out-of-coverage is an ANSWER here.
    resp = client.get("/api/ambient/quote", params={"lat": 25.2, "lon": 55.27, "date": CACHED_DAY})
    assert resp.status_code == 200, resp.text
    assert resp.json()["in_coverage"] is False


def test_an_uncached_site_day_names_its_price_instead_of_paying_it(
    client: TestClient,
) -> None:
    # Denver: inside coverage, not on disk. Without allow_live this must refuse.
    resp = client.post(
        "/api/ambient", json={"lat": 39.74, "lon": -104.99, "date": CACHED_DAY}
    )
    assert resp.status_code == 409, resp.text
    assert "4220 credits" in resp.json()["detail"]

    quote = client.get(
        "/api/ambient/quote", params={"lat": 39.74, "lon": -104.99, "date": CACHED_DAY}
    ).json()
    assert quote["cached"] is False
    assert quote["credits"] == 4220


# The committed cache is deliberately NOT visible to tests - conftest points CACHE_DIR at
# a tmp_path, so nothing here can pass because of a file someone happened to fetch. So
# seed one day into that empty cache and check the route reads it instead of calling out.
def seed_cached_day(lat: float, lon: float, day: str) -> None:
    from app.services.cache import cache_path
    from app.services.location import polygon_for
    from app.services.season import CACHE_NAME, day_params

    settings = get_settings()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path(settings.cache_dir, CACHE_NAME, day_params(polygon_for(lat, lon), day))
    path.write_text(json.dumps({
        "result": {"map_data": {"features": [
            {"properties": {"tile_id": "t1", "min_temperature": 30.0,
                            "average_temperature": 36.5, "max_temperature": 43.0}},
        ]}}
    }))


def test_a_cached_site_day_costs_nothing(client: TestClient) -> None:
    params = {**PHOENIX, "date": CACHED_DAY}
    assert client.get("/api/ambient/quote", params=params).json()["cached"] is False

    seed_cached_day(PHOENIX["lat"], PHOENIX["lon"], CACHED_DAY)
    quote = client.get("/api/ambient/quote", params=params).json()
    assert quote["cached"] is True
    assert quote["credits"] == 0
    assert quote["mode"] == "archive"


def test_dates_outside_archive_and_forecast_are_named_not_guessed(
    client: TestClient,
) -> None:
    before = client.get("/api/ambient/quote", params={**PHOENIX, "date": "2019-05-01"}).json()
    assert "archive starts" in before["reason"]
    after = client.get("/api/ambient/quote", params={**PHOENIX, "date": "2099-05-01"}).json()
    assert "forecast horizon" in after["reason"]


def test_ambient_echoes_the_location_it_resolved(client: TestClient) -> None:
    seed_cached_day(PHOENIX["lat"], PHOENIX["lon"], CACHED_DAY)
    resp = client.post(
        "/api/ambient",
        json={**PHOENIX, "date": CACHED_DAY, "placement_hour": 14, "duration_hours": 72.0},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["resolved_lat_deg"] == PHOENIX["lat"]
    assert data["resolved_lon_deg"] == PHOENIX["lon"]
    assert data["source"] == "cached"
    assert data["credits_spent"] == 0
    assert len(data["ambient"]["air_temp_c"]) == 73


# THE point of the whole control: latitude has to reach build_ambient, not sit in a
# caption. Same day, same daily min/mean/max, two latitudes - the solar term must move.
def test_latitude_reaches_the_solar_term(client: TestClient) -> None:
    from physics.season_analysis import DayWeather, build_ambient

    day = DayWeather(date=CACHED_DAY, day_of_year=196, t_min_c=30.0, t_mean_c=36.5,
                     t_max_c=43.0)
    phoenix = build_ambient(day, 33.45, 14, hours=72.0)
    anchorage = build_ambient(day, 61.22, 14, hours=72.0)

    # July: the far north has a much longer day, so more daylight hours carry sun.
    assert int(np.count_nonzero(anchorage.ghi_w_m2)) > int(np.count_nonzero(phoenix.ghi_w_m2))
    assert not np.allclose(phoenix.ghi_w_m2, anchorage.ghi_w_m2)
    # and the air temperature curve follows it, because Parton-Logan is driven by
    # sunrise and daylength too.
    assert not np.allclose(phoenix.air_temp_c, anchorage.air_temp_c)
