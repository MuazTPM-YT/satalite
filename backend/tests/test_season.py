"""Quota discipline and the fixed standard element. No test here touches the network."""

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from app.config import get_settings
from app.services import season
from physics.season_analysis import STANDARD_ELEMENT, season_exposure, standard_mix

PHOENIX = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
           "geometry": {"type": "Polygon", "coordinates": [[[-112.1, 33.4], [-112.0, 33.4],
                        [-112.0, 33.5], [-112.1, 33.5], [-112.1, 33.4]]]}}]}


def test_phoenix_summer_is_92_days() -> None:
    assert len(season.dates_between("2025-06-01", "2025-08-31")) == 92


def test_backwards_range_is_rejected() -> None:
    with pytest.raises(ValueError, match="before"):
        season.dates_between("2025-08-31", "2025-06-01")


def test_remaining_credits_finds_a_nested_balance() -> None:
    usage = {"data": {"usage": {"credits_remaining": 1_612_000}}}
    assert season.remaining_credits(usage) == 1_612_000


# a balance we cannot read must stop the run, not be assumed generous
def test_unreadable_usage_refuses_to_spend() -> None:
    with pytest.raises(season.QuotaTooLowError, match="blind"):
        season.remaining_credits({"plan": "premium"})


# granularity and filter_type are load-bearing on cost. lock them.
def test_day_params_are_the_cheap_ones() -> None:
    params = season.day_params(PHOENIX, "2025-06-01")
    assert params["granularity"] == 100
    assert params["filter_type"] == 3


# a run that dies must not refetch on restart. this is the whole point of the module.
def test_fetch_season_resumes_without_refetching(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    calls: list[str] = []

    def fake_fetch(params: dict[str, Any], _settings: Any = None) -> dict[str, Any]:
        calls.append(params["start_date"])
        path = season.cache_path(settings.cache_dir, season.CACHE_NAME, params)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"activity_id": "fake", "result": {}}))
        return {"activity_id": "fake"}

    monkeypatch.setattr(season, "fetch_heatmap", fake_fetch)
    monkeypatch.setattr(season, "check_credits", lambda *_a, **_k: 2_000_000.0)

    season.fetch_season(PHOENIX, "2025-06-01", "2025-06-10", max_calls_per_run=4)
    assert calls == ["2025-06-01", "2025-06-02", "2025-06-03", "2025-06-04"]

    # second run picks up at day 5 and refetches nothing
    calls.clear()
    season.fetch_season(PHOENIX, "2025-06-01", "2025-06-10", max_calls_per_run=4)
    assert calls == ["2025-06-05", "2025-06-06", "2025-06-07", "2025-06-08"]

    calls.clear()
    season.fetch_season(PHOENIX, "2025-06-01", "2025-06-10", max_calls_per_run=4)
    assert calls == ["2025-06-09", "2025-06-10"]

    # and once complete it makes no calls at all
    calls.clear()
    season.fetch_season(PHOENIX, "2025-06-01", "2025-06-10", max_calls_per_run=4)
    assert calls == []

    marker = season.checkpoint_path(settings.cache_dir, "2025-06-01", "2025-06-10")
    assert json.loads(marker.read_text())["complete"] is True


def test_low_balance_stops_before_spending(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(season, "check_credits", lambda *_a, **_k: 99_000.0)
    monkeypatch.setattr(
        season, "fetch_heatmap", lambda *_a, **_k: pytest.fail("must not call the API")
    )
    with pytest.raises(season.QuotaTooLowError, match="below the 100000 floor"):
        season.fetch_season(PHOENIX, "2025-06-01", "2025-06-02")


def test_a_day_that_was_never_fetched_is_not_invented() -> None:
    with pytest.raises(KeyError, match="not cached"):
        season.cached_day(PHOENIX, "2025-06-01")


def test_reducing_heatmaps_to_daily_stats_is_still_blocked() -> None:
    with pytest.raises(NotImplementedError, match="response schema"):
        season.season_records(PHOENIX, "2025-06-01", "2025-06-02")


# ---------------------------------------------------------------------------
# The standard element was fixed on 2026-08-22. Tuning it after seeing a result
# would invalidate every season number. This test exists to make that loud.
# ---------------------------------------------------------------------------
def test_standard_element_has_not_been_tuned() -> None:
    assert STANDARD_ELEMENT.shape == "slab"
    assert STANDARD_ELEMENT.dims_mm["thickness"] == 300.0
    assert STANDARD_ELEMENT.formwork == "plywood_18mm"
    assert STANDARD_ELEMENT.on_ground is False


def test_standard_mix_matches_the_stated_design() -> None:
    mix = standard_mix()
    assert mix.cement_kg_m3 == 400.0
    # 20% fly ash at w/cm 0.45: Schindler-Folliard ultimate degree, not a guess
    assert mix.alpha_u == pytest.approx(0.8204, abs=1e-3)
    assert 300e3 < mix.h_u_j_per_kg < 500e3
    assert 5.0 < mix.tau_h < 40.0


# same element, coarser grid: these tests check the bookkeeping around the solve, not
# the solve itself, and dx = 10 mm over 92 days is a batch job, not a unit test.
COARSE = replace(STANDARD_ELEMENT, dx_m=0.03)

SYNTHETIC = [
    {"date": "2025-06-01", "day_of_year": 152, "t_min_c": 27.0, "t_mean_c": 34.0,
     "t_max_c": 42.0},
    {"date": "2025-06-02", "day_of_year": 153, "t_min_c": 20.0, "t_mean_c": 25.0,
     "t_max_c": 31.0},
]


def test_season_exposure_reports_percentages_and_a_delta() -> None:
    out = season_exposure(SYNTHETIC, element=COARSE)
    assert out["n_days"] == 2
    assert set(out["per_placement_hour"]) == {"4", "14"}
    for stats in out["per_placement_hour"].values():
        for key, value in stats.items():
            if key.startswith("pct_"):
                assert 0.0 <= value <= 100.0

    # an afternoon pour on a hot day cannot come out cooler than a pre-dawn one
    assert out["delta_14_minus_04"]["mean_peak_core_temp_c"] > 0.0

    # the unmeasured inputs must be stated, not buried
    assert "not measured" in out["assumptions"]["note"].lower()


def test_season_exposure_refuses_an_empty_season() -> None:
    with pytest.raises(ValueError, match="empty"):
        season_exposure([])


def test_written_analysis_is_servable_json(tmp_path: Path) -> None:
    path = season.write_season_analysis(SYNTHETIC, element=COARSE)
    payload = json.loads(path.read_text())
    assert payload["element"]["fixed_on"] == "2026-08-22"
