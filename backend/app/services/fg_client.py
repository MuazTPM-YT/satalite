"""Thin wrapper over the vendored FortyGuard client. Always goes through the cache."""

import logging
from typing import Any

from starlette.concurrency import run_in_threadpool

from app.config import Settings, get_settings
from app.services.cache import cached_call
from vendor.fortyguard import FortyGuardClient

log = logging.getLogger(__name__)


# build client from settings. auth is an `api-key` header, client does that itself.
def build_client(settings: Settings | None = None) -> FortyGuardClient:
    settings = settings or get_settings()
    return FortyGuardClient(
        api_key=settings.fortyguard_api_key,
        base_url=settings.fortyguard_base_url,
    )


# submit heatmap, poll to done, hand back payload under ["result"]. cached by params.
def fetch_heatmap(params: dict[str, Any], settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()

    def _call() -> dict[str, Any]:
        client = build_client(settings)
        # wait=True so shape is always {"activity_id":..., "result":...}. verbose=False, we log.
        envelope = client.create_heatmap(**params, wait=True, verbose=False)
        assert isinstance(envelope, dict)
        log.info("fortyguard heatmap activity_id=%s", envelope.get("activity_id"))
        return envelope

    payload: dict[str, Any] = cached_call(settings.cache_dir, "heatmap", params, _call)
    return payload


# same call, off the event loop. vendored client is blocking requests.
async def fetch_heatmap_async(
    params: dict[str, Any], settings: Settings | None = None
) -> dict[str, Any]:
    return await run_in_threadpool(fetch_heatmap, params, settings)


# every tile's temperature, keyed by tile id.
#
# SPATIAL, not temporal. A filter_type=3 heatmap carries one min/mean/max triple per
# tile for the whole day and no hourly data at all, so there is no time axis to build a
# series along - the "series" here runs across the 221 tiles of the AOI, and the str is
# a tile_id, never a timestamp. Hourly data needs filter_type=1 and a different parser.
#
# Celsius out. The vendored docstring claims tcm tiles are Fahrenheit - it is WRONG.
# Verified against 2025-07-15 downtown Phoenix: tiles read 32.7-40.3, which is a Phoenix
# July day in C (91-104 F). Read as Fahrenheit those would be 0.4-4.6 C in July.
def tiles_to_series_c(
    heatmap_payload: dict[str, Any], field: str = "average_temperature"
) -> list[tuple[str, float]]:
    features = tiles(heatmap_payload)
    return [
        (str(feature["properties"]["tile_id"]), float(feature["properties"][field]))
        for feature in features
        if feature["properties"].get(field) is not None
    ]


# the tile features, from either the full envelope or a bare result block.
#
# create_heatmap(wait=True) returns {"activity_id":..., "result": {...}} and map_data
# lives under ["result"]. Accepting both shapes means a caller holding one or the other
# cannot silently get an empty list.
def tiles(heatmap_payload: dict[str, Any]) -> list[dict[str, Any]]:
    result = heatmap_payload.get("result", heatmap_payload)
    features = result["map_data"]["features"]
    if not features:
        raise ValueError("heatmap payload has no tiles - refusing to reduce an empty AOI")
    return [f for f in features]
