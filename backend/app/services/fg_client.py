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


# celsius out. vendored docstring claims tiles are fahrenheit - it is wrong.
def tiles_to_series_c(heatmap_payload: dict[str, Any]) -> list[tuple[str, float]]:
    raise NotImplementedError
