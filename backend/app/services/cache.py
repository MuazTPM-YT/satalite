"""Disk cache for FortyGuard responses. Quota is small, so this is load-bearing."""

import hashlib
import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


# stable hash of request kwargs. sorted keys so arg order never changes the key.
def request_key(name: str, params: dict[str, Any]) -> str:
    blob = json.dumps({"name": name, "params": params}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


# where a given request's response lives. same key, same file, every time.
def cache_path(cache_dir: Path, name: str, params: dict[str, Any]) -> Path:
    return cache_dir / f"{name}-{request_key(name, params)}.json"


# already on disk? lets a caller skip work without paying for a call to find out.
def is_cached(cache_dir: Path, name: str, params: dict[str, Any]) -> bool:
    return cache_path(cache_dir, name, params).exists()


# read-through cache. miss calls fetch() once, then writes json to disk.
def cached_call(
    cache_dir: Path,
    name: str,
    params: dict[str, Any],
    fetch: Callable[[], Any],
) -> Any:
    path = cache_path(cache_dir, name, params)
    if path.exists():
        log.info("cache hit %s", path.name)
        return json.loads(path.read_text())

    log.info("cache miss %s, calling api", path.name)
    payload = fetch()
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, default=str))
    tmp.replace(path)
    return payload
