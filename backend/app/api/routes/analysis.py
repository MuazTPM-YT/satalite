"""Precomputed results. These routes read files and nothing else.

A season replay is 184 solves and the validation harness is a batch job. Neither belongs
on a request thread, and both are answers to a question that does not change between
requests, so both are built offline and served from disk. If the file is missing the
answer is 503 with the command to build it - never a live compute, never a placeholder.
"""

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.models import SeasonAnalysisResponse, ValidationResponse

log = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])

SEASON_FILENAME = "season-analysis.json"
VALIDATION_PATH = Path(__file__).resolve().parents[4] / "docs" / "VALIDATION.json"


# read a precomputed json file or explain exactly how to make it.
def _load(path: Path, how_to_build: str) -> dict[str, Any]:
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"{path.name} has not been built yet. {how_to_build}",
        )
    payload: dict[str, Any] = json.loads(path.read_text())
    return payload


# serve the season replay. never computes.
@router.get("/season-analysis", response_model=SeasonAnalysisResponse)
async def season_analysis() -> SeasonAnalysisResponse:
    path = get_settings().cache_dir / SEASON_FILENAME
    return SeasonAnalysisResponse(
        **_load(
            path,
            "Fetch the season with app.services.season.fetch_season, then run "
            "physics.season_analysis.season_exposure and write the result here.",
        )
    )


# serve the validation summary. never computes.
@router.get("/validation", response_model=ValidationResponse)
async def validation() -> ValidationResponse:
    return ValidationResponse(
        **_load(VALIDATION_PATH, "Run `pytest validation/ -m validation` to generate it.")
    )
