import logging
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", Path(".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # no default. missing key = loud crash at startup, not a silent 401 later.
    fortyguard_api_key: str = Field(min_length=1)
    fortyguard_base_url: str = "https://api.fortyguard.com"
    cache_dir: Path = _REPO_ROOT / "backend" / "data" / "cache"


# one settings object per process. cached so .env read once.
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()  # type: ignore[call-arg]
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    return settings
