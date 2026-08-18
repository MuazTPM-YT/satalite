import os

import pytest

from app.config import get_settings


# fake key so settings load in tests. never a real one.
@pytest.fixture(autouse=True)
def _env(tmp_path_factory: pytest.TempPathFactory) -> None:
    os.environ["FORTYGUARD_API_KEY"] = "test-key-not-real"
    os.environ["CACHE_DIR"] = str(tmp_path_factory.mktemp("cache"))
    get_settings.cache_clear()
