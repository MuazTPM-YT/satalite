"""Fetch a season of daily temperature, one call per day, resumably.

Quota is the binding constraint on this whole project, not compute. A heatmap costs a
flat 4220 credits whatever the area or granularity, and 2,000,000 credits is roughly 474
calls in total, ever. So: one call per day, granularity always 100 (60 returns the same
values to three decimals and costs the same), and filter_type=3 because it returns per
tile min, mean AND max together - three separate calls for the same three numbers would
burn the budget in a third of a season.

Resumability is not a nicety here. A run that dies at day 41 and refetches days 1-40 on
restart costs 168,800 credits to learn nothing. Every completed day is on disk before the
next call goes out, and the cache is checked before any call is made.
"""

import json
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from app.config import Settings, get_settings
from app.services.cache import cache_path, is_cached
from app.services.fg_client import build_client, fetch_heatmap

log = logging.getLogger(__name__)

CACHE_NAME = "heatmap"
GRANULARITY_M = 100      # never change: 60 gives identical values and costs the same
FILTER_TYPE_DAY = 3      # single day, per-tile min/mean/max in one call
CREDITS_PER_CALL = 4220  # flat, regardless of area or granularity
MIN_CREDITS_TO_START = 100_000


class QuotaTooLowError(RuntimeError):
    """Stop before spending, not after. Refetching is the one unaffordable mistake."""


# every date in the inclusive range.
def dates_between(start_date: str, end_date: str) -> list[str]:
    start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    if end < start:
        raise ValueError(f"end_date {end_date} is before start_date {start_date}")
    return [(start + timedelta(days=n)).isoformat() for n in range((end - start).days + 1)]


# the exact params one day's call is made with. also the cache key, so it must be stable.
def day_params(polygon: dict[str, Any], day: str) -> dict[str, Any]:
    return {
        "polygon_aoi": polygon,
        "start_date": day,
        "filter_type": FILTER_TYPE_DAY,
        "granularity": GRANULARITY_M,
    }


# remaining credits from the usage payload. the response shape is not documented in the
# vendored client, so search rather than guess a key - and fail loudly if nothing matches,
# because a silently-assumed balance is how a budget gets spent twice.
def remaining_credits(usage: dict[str, Any]) -> float:
    wanted = ("remaining", "available", "balance", "credits_left")

    def walk(node: Any) -> float | None:
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, int | float) and any(w in key.lower() for w in wanted):
                    return float(value)
            for value in node.values():
                found = walk(value)
                if found is not None:
                    return found
        return None

    found = walk(usage)
    if found is None:
        raise QuotaTooLowError(
            "cannot read remaining credits from the usage payload "
            f"(top-level keys: {sorted(usage)}). Refusing to spend quota blind."
        )
    return found


# current balance, straight from the API. not cached: a stale balance is worse than none.
def check_credits(settings: Settings | None = None) -> float:
    settings = settings or get_settings()
    return remaining_credits(build_client(settings).fetch_api_key_usage())


# progress marker. the cache is the real source of truth, this is for humans and resume.
def checkpoint_path(cache_dir: Path, start_date: str, end_date: str) -> Path:
    return cache_dir / f"season-{start_date}-to-{end_date}.checkpoint.json"


# write the marker atomically, so a kill mid-write cannot leave a half-parsed file.
def write_checkpoint(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=1, default=str))
    tmp.replace(path)


# read the marker back. absent or corrupt is the same as "nothing done yet".
def read_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"done": [], "calls_made": 0}
    try:
        state: dict[str, Any] = json.loads(path.read_text())
        return state
    except json.JSONDecodeError:
        log.warning("checkpoint %s unreadable, starting from the cache instead", path.name)
        return {"done": [], "calls_made": 0}


# fetch a season of daily min/mean/max. resumable, checkpointed.
def fetch_season(
    polygon: dict[str, Any],
    start_date: str,
    end_date: str,
    max_calls_per_run: int = 25,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    days = dates_between(start_date, end_date)
    marker = checkpoint_path(settings.cache_dir, start_date, end_date)
    state = read_checkpoint(marker)

    pending = [day for day in days if not is_cached(settings.cache_dir, CACHE_NAME,
                                                    day_params(polygon, day))]
    log.info(
        "season %s..%s: %d days, %d cached, %d pending",
        start_date, end_date, len(days), len(days) - len(pending), len(pending),
    )
    if not pending:
        log.info("season complete, no calls needed")
        state["done"] = days
        state["complete"] = True
        write_checkpoint(marker, state)
        return

    credits_before = check_credits(settings)
    log.info(
        "credits before: %.0f. %d pending days would cost %d",
        credits_before, len(pending), len(pending) * CREDITS_PER_CALL,
    )
    if credits_before < MIN_CREDITS_TO_START:
        raise QuotaTooLowError(
            f"{credits_before:.0f} credits remaining, below the {MIN_CREDITS_TO_START} floor. "
            "Not starting."
        )

    calls_this_run = 0
    try:
        for day in days:
            params = day_params(polygon, day)
            if is_cached(settings.cache_dir, CACHE_NAME, params):
                continue
            if calls_this_run >= max_calls_per_run:
                log.info(
                    "hit max_calls_per_run=%d, stopping cleanly. rerun to continue.",
                    max_calls_per_run,
                )
                break

            fetch_heatmap(params, settings)
            calls_this_run += 1

            # checkpoint AFTER the cache write, so a kill here loses nothing but the marker
            state["done"] = [
                d for d in days
                if is_cached(settings.cache_dir, CACHE_NAME, day_params(polygon, d))
            ]
            state["calls_made"] = int(state.get("calls_made", 0)) + 1
            state["last_day"] = day
            write_checkpoint(marker, state)
    finally:
        state["complete"] = len(state.get("done", [])) == len(days)
        write_checkpoint(marker, state)
        log.info(
            "credits after: %.0f (%d calls this run, %d/%d days cached)",
            check_credits(settings), calls_this_run, len(state.get("done", [])), len(days),
        )


# cached heatmaps in, the daily records season_exposure wants out.
def season_records(
    polygon: dict[str, Any], start_date: str, end_date: str, settings: Settings | None = None
) -> list[dict[str, Any]]:
    raise NotImplementedError(
        "reducing a filter_type=3 tcm heatmap to per-day t_min_c/t_mean_c/t_max_c needs the "
        "real response schema, which no cached response exists to confirm. Blocked on the "
        "same unknown as fg_client.tiles_to_series_c - run one live day first, then write "
        "both parsers against the actual payload. Returning zeros here would be worse."
    )


# read-through helper for one day, so callers never reach past the cache.
def cached_day(
    polygon: dict[str, Any], day: str, settings: Settings | None = None
) -> dict[str, Any]:
    settings = settings or get_settings()
    path = cache_path(settings.cache_dir, CACHE_NAME, day_params(polygon, day))
    if not path.exists():
        raise KeyError(f"{day} is not cached. Run fetch_season first; this never calls the API.")
    payload: dict[str, Any] = json.loads(path.read_text())
    return payload


# build the json the /api/season-analysis route serves. offline job, never a request.
def write_season_analysis(
    records: list[dict[str, Any]], settings: Settings | None = None, **kwargs: Any
) -> Path:
    from physics.season_analysis import season_exposure

    settings = settings or get_settings()
    out_path = settings.cache_dir / "season-analysis.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(season_exposure(records, **kwargs), indent=1))
    log.info("wrote %s from %d cached days", out_path, len(records))
    return out_path
