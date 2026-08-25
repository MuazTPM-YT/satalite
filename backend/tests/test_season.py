"""Quota discipline and the fixed standard element. No test here touches the network."""

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings, get_settings
from app.services import season
from app.services.fg_client import tiles_to_series_c
from physics.season_analysis import STANDARD_ELEMENT, season_exposure, standard_mix

# the real one, not a second copy: this polygon is the cache key, and a test that
# fetched against a different box would prove nothing about the committed cache.
PHOENIX = season.DOWNTOWN_PHOENIX

# the one live day committed to data/cache/, so the demo needs no network
COMMITTED_DAY = "2025-07-15"


# conftest points the cache at a tmp dir so no test can touch the committed one by
# accident. The real-payload tests below want the committed day, so they ask for it.
@pytest.fixture
def real_cache() -> Settings:
    return Settings(cache_dir=Path(__file__).resolve().parents[1] / "data" / "cache")


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


# a strided sample must fetch exactly the days asked for and nothing between them.
# fetching the gaps is the expensive mistake this argument exists to prevent.
def test_fetch_season_days_argument_fetches_only_the_stride(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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

    stride = ["2025-07-01", "2025-07-04", "2025-07-07", "2025-07-10"]
    season.fetch_season(PHOENIX, "2025-07-01", "2025-07-10", days=stride)
    assert calls == stride

    # rerunning is free, and season_records must resolve the same list
    calls.clear()
    season.fetch_season(PHOENIX, "2025-07-01", "2025-07-10", days=stride)
    assert calls == []
    assert season._days_in_range("2025-07-01", "2025-07-10", stride) == stride


# a day outside the range would be bought and then never read back. crash instead.
def test_days_outside_the_range_are_rejected() -> None:
    with pytest.raises(ValueError, match="outside"):
        season._days_in_range("2025-07-01", "2025-07-10", ["2025-07-01", "2025-08-15"])


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


# an uncached day must stop the reduction, not quietly shorten the season
def test_season_records_refuses_to_skip_missing_days() -> None:
    with pytest.raises(KeyError, match="not cached"):
        season.season_records(PHOENIX, "2025-06-01", "2025-06-02")


# ---------------------------------------------------------------------------
# Parsed against the real committed 2025-07-15 payload. These numbers come from
# live data, so a schema change or a unit slip breaks the test rather than the demo.
# ---------------------------------------------------------------------------
def test_committed_day_reduces_to_real_celsius(real_cache: Settings) -> None:
    (record,) = season.season_records(PHOENIX, COMMITTED_DAY, COMMITTED_DAY, real_cache)
    assert record["n_tiles"] == 221
    assert record["day_of_year"] == 196
    assert record["t_min_c"] == pytest.approx(32.78, abs=0.01)
    assert record["t_mean_c"] == pytest.approx(36.95, abs=0.01)
    assert record["t_max_c"] == pytest.approx(40.20, abs=0.01)
    # ordering is the unit check: read as Fahrenheit these would be 0.4-4.6 C in July
    assert record["t_min_c"] < record["t_mean_c"] < record["t_max_c"]


# stats_data.temperature_stats describes the spread of average_temperature ACROSS TILES,
# not the day's air-temperature range. Reading it as the daily range loses 7 C of swing.
def test_stats_data_is_not_the_daily_range(real_cache: Settings) -> None:
    stats = season.cached_day(PHOENIX, COMMITTED_DAY, real_cache)["result"]["stats_data"]
    (record,) = season.season_records(PHOENIX, COMMITTED_DAY, COMMITTED_DAY, real_cache)
    assert stats["temperature_stats"]["minimum"] > record["t_min_c"] + 3.0
    assert stats["temperature_stats"]["maximum"] < record["t_max_c"] - 3.0


def test_tiles_to_series_is_spatial_and_celsius(real_cache: Settings) -> None:
    series = tiles_to_series_c(season.cached_day(PHOENIX, COMMITTED_DAY, real_cache))
    assert len(series) == 221
    assert all(20.0 < temp_c < 50.0 for _, temp_c in series)


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
    assert mix.cementitious_kg_m3 == 400.0
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
