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
from collections.abc import Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from app.config import Settings, get_settings
from app.services.cache import cache_path, is_cached
from app.services.fg_client import build_client, fetch_heatmap
from app.services.fg_client import tiles as fg_tiles

log = logging.getLogger(__name__)

CACHE_NAME = "heatmap"

# Downtown Phoenix, 1699 x 1487 m (2.53 km2). FIXED - this polygon is part of the cache
# key, so changing a single digit orphans every cached day and re-buys the season at
# 4220 credits each. Area does not affect price; it was chosen small so a whole season
# of cached responses stays committable.
DOWNTOWN_PHOENIX = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-112.08673519715168, 33.46131041281569],
                    [-112.06844426969921, 33.46131041281569],
                    [-112.06844426969921, 33.44790559096451],
                    [-112.08673519715168, 33.44790559096451],
                    [-112.08673519715168, 33.46131041281569],
                ]],
            },
        }
    ],
}

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


# the days a run covers: the whole inclusive range, or an explicit subset of it.
#
# The subset is checked against the range rather than trusted. A day outside it would be
# fetched and cached but never read back by season_records, which resolves its own list
# the same way - the two would silently disagree about what the season contains.
def _days_in_range(
    start_date: str, end_date: str, days: Sequence[str] | None
) -> list[str]:
    in_range = dates_between(start_date, end_date)
    if days is None:
        return in_range
    chosen = list(dict.fromkeys(days))
    outside = [day for day in chosen if day not in set(in_range)]
    if outside:
        raise ValueError(
            f"{len(outside)} day(s) fall outside {start_date}..{end_date} "
            f"(first: {outside[0]}). The range names the checkpoint, so it has to hold them."
        )
    return sorted(chosen)


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
#
# Two traps, both hit against the live payload:
#   bool is a subclass of int, so `api_key_details.api_access_available: True` used to
#   match and return 1.0 - a balance low enough to block every run.
#   "available" also matches `total_available_credits`, which is the PLAN SIZE, not the
#   balance. So the words are tried in priority order and "remaining" wins outright.
WANTED_CREDIT_KEYS = ("remaining", "credits_left", "balance", "available")


# first numeric value under a key containing `word`. bools are not numbers here.
def _find_number(node: Any, word: str) -> float | None:
    if not isinstance(node, dict):
        return None
    for key, value in node.items():
        if isinstance(value, int | float) and not isinstance(value, bool) and word in key.lower():
            return float(value)
    for value in node.values():
        found = _find_number(value, word)
        if found is not None:
            return found
    return None


def remaining_credits(usage: dict[str, Any]) -> float:
    for word in WANTED_CREDIT_KEYS:
        found = _find_number(usage, word)
        if found is not None:
            return found
    raise QuotaTooLowError(
        "cannot read remaining credits from the usage payload "
        f"(top-level keys: {sorted(usage)}). Refusing to spend quota blind."
    )


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
#
# `days` overrides the day-by-day walk with an explicit list, which is how a strided
# sample gets fetched: 30 days on a 3-day stride costs 126,600 credits against 388,240
# for all 92, and a summer's breach fraction does not need consecutive days. Every day
# given must fall inside [start_date, end_date] - those two still name the checkpoint,
# and a marker whose range does not contain its own days is a resume waiting to go wrong.
def fetch_season(
    polygon: dict[str, Any],
    start_date: str,
    end_date: str,
    max_calls_per_run: int = 25,
    settings: Settings | None = None,
    days: Sequence[str] | None = None,
) -> None:
    settings = settings or get_settings()
    days = _days_in_range(start_date, end_date, days)
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


# one cached day in, the single min/mean/max triple season_exposure wants out.
#
# Written against the real 2025-07-15 downtown Phoenix payload, not an assumed schema.
# Each tile carries average_temperature / min_temperature / max_temperature, all Celsius,
# and the AOI is reduced by averaging each field ACROSS tiles: the season replays one
# standard element at one site, so it needs one number per field, and the tile mean is
# the stable choice. Over 2.53 km2 the tiles spread only ~0.1 C in the daily mean, so the
# choice of reducer barely moves the answer here - it would matter over a whole metro.
#
# DO NOT use stats_data.temperature_stats for this. Those min/max fields describe the
# spread of average_temperature ACROSS TILES (36.91 to 37.01 on 2025-07-15), not the
# day's minimum and maximum air temperature (32.78 and 40.20). Reading them as the daily
# range understates the diurnal swing by 7 C and silently flattens every solve.
def day_record(day: str, payload: dict[str, Any]) -> dict[str, Any]:
    features = fg_tiles(payload)
    n = len(features)

    def tile_mean(field: str) -> float:
        values = [
            float(f["properties"][field])
            for f in features
            if f["properties"].get(field) is not None
        ]
        if not values:
            raise ValueError(f"no tile in the {day} heatmap carries {field}")
        return sum(values) / len(values)

    return {
        "date": day,
        "day_of_year": date.fromisoformat(day).timetuple().tm_yday,
        "t_min_c": tile_mean("min_temperature"),
        "t_mean_c": tile_mean("average_temperature"),
        "t_max_c": tile_mean("max_temperature"),
        "n_tiles": n,
    }


# is a lon/lat point inside a tile's ring? ray casting, in degrees.
#
# The tiles are a rotated grid - a projected grid a fraction of a degree off north - so
# a bounding-box test picks the wrong tile along every edge. The half-open crossing rule
# `(y0 > lat) != (y1 > lat)` gives a shared edge to exactly one of the two tiles that
# meet on it, so a point never resolves to two tiles or to none.
def point_in_ring(lon: float, lat: float, ring: Sequence[Sequence[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        x_i, y_i = float(ring[i][0]), float(ring[i][1])
        x_j, y_j = float(ring[j][0]), float(ring[j][1])
        if (y_i > lat) != (y_j > lat) and lon < (x_j - x_i) * (lat - y_i) / (y_j - y_i) + x_i:
            inside = not inside
        j = i
    return inside


# the tile a point falls in, or None when it falls outside every one of them.
def tile_at(payload: dict[str, Any], lat: float, lon: float) -> dict[str, Any] | None:
    for feature in fg_tiles(payload):
        geometry = feature.get("geometry")
        if not geometry or geometry.get("type") != "Polygon":
            continue
        if point_in_ring(lon, lat, geometry["coordinates"][0]):
            return feature
    return None


# ONE TILE's own min/mean/max, for a pour at a stated point.
#
# day_record averages every tile in the AOI, which is the right reducer for the season
# replay: it replays one standard element at one site, so it needs one number per field
# per day. It is the wrong reducer for a point. The whole claim of this project is that
# air temperature varies street by street, and averaging 221 tiles is exactly the step
# that throws that variation away - 0.1 C of it in the daily mean on the demo day, and
# 0.37 C in the daily minimum.
#
# So a pour at a stated point can be solved against the tile it actually sits in. Same
# fields, same units, same shape as day_record; the caller says which it wants and the
# response says which it got, because a curve built from one tile and a curve built from
# 221 must never be mistaken for each other.
#
# Returns None when the point is outside every tile - the caller then falls back to the
# AOI mean and reports that it did, rather than quietly inventing a nearest tile.
def tile_record(day: str, payload: dict[str, Any], lat: float, lon: float) -> dict[str, Any] | None:
    feature = tile_at(payload, lat, lon)
    if feature is None:
        return None
    props = feature["properties"]
    fields = {
        "t_min_c": "min_temperature",
        "t_mean_c": "average_temperature",
        "t_max_c": "max_temperature",
    }
    values: dict[str, Any] = {}
    for out_name, api_name in fields.items():
        value = props.get(api_name)
        # A tile missing one of the three cannot shape a diurnal curve, and substituting
        # the AOI mean for the missing one would blend two reducers inside a single day.
        if value is None:
            return None
        values[out_name] = float(value)
    return {
        "date": day,
        "day_of_year": date.fromisoformat(day).timetuple().tm_yday,
        **values,
        "n_tiles": 1,
        "tile_id": str(props["tile_id"]),
    }


# cached heatmaps in, the daily records season_exposure wants out. never calls the API.
#
# A missing day is an error, not a gap to skip over. Quietly returning 40 days when 92
# were asked for would produce a season statistic that reads like a full summer.
def season_records(
    polygon: dict[str, Any],
    start_date: str,
    end_date: str,
    settings: Settings | None = None,
    days: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    settings = settings or get_settings()
    days = _days_in_range(start_date, end_date, days)
    missing = [
        day for day in days if not is_cached(settings.cache_dir, CACHE_NAME,
                                             day_params(polygon, day))
    ]
    if missing:
        raise KeyError(
            f"{len(missing)} of {len(days)} days are not cached "
            f"(first: {missing[0]}, last: {missing[-1]}). Run fetch_season first - "
            "season_records never calls the API."
        )
    return [day_record(day, cached_day(polygon, day, settings)) for day in days]


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
