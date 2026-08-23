import logging
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
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

    # where `pytest validation/ -m validation` leaves its report. A setting, not a walk
    # up from __file__: the container flattens the repo layout, so counting parents finds
    # a directory that does not exist there and the route 503s for the wrong reason.
    validation_path: Path = _REPO_ROOT / "docs" / "VALIDATION.json"

    # browsers block a cross-origin fetch unless the server names the origin. Localhost
    # only by default; a deployment MUST add its own frontend origin or the demo link
    # loads and then fails every request.
    #
    # Held as a comma-separated STRING, not a list: pydantic-settings 2.6 json-decodes a
    # list field straight out of the env and raises before any validator can run, so a
    # plain ALLOWED_ORIGINS=https://a,https://b would crash at startup. Deploy panels take
    # one line of text, and demanding json there is how an origin list ends up empty in
    # production. Read it through .cors_origins.
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # a relative CACHE_DIR is anchored to the repo, never to the working directory.
    # .env ships CACHE_DIR=backend/data/cache, so cwd used to decide the answer: uvicorn
    # from the repo root and pytest from backend/ resolved to two different caches, and a
    # cache that moves when you cd is a cache that re-buys the season at 4220 a day.
    @field_validator("cache_dir", "validation_path")
    @classmethod
    def _anchor_to_repo(cls, value: Path) -> Path:
        return value if value.is_absolute() else _REPO_ROOT / value

    # the origin list the CORS middleware actually gets.
    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


# one settings object per process. cached so .env read once.
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()  # type: ignore[call-arg]
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    return settings
