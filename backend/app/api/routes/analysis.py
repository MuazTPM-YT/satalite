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
from app.models import DemoEnsembleResponse, SeasonAnalysisResponse, ValidationResponse

log = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])

SEASON_FILENAME = "season-analysis.json"
DEMO_ENSEMBLE_FILENAME = "demo-ensemble.json"


# read a precomputed json file or explain exactly how to make it.
def _load(path: Path, how_to_build: str) -> dict[str, Any]:
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"{path.name} has not been built yet. {how_to_build}",
        )
    payload: dict[str, Any] = json.loads(path.read_text())
    return payload


# serve the season replay. never computes, never 503s.
#
# The other two artifacts are cheap to rebuild; a season is 4220 credits a day of real
# money and an image can legitimately ship without one. So this route degrades instead
# of failing: available=False at 200, with the build command in detail.
@router.get("/season-analysis", response_model=SeasonAnalysisResponse)
async def season_analysis() -> SeasonAnalysisResponse:
    path = get_settings().cache_dir / SEASON_FILENAME
    if not path.exists():
        log.info("season-analysis not in this build, serving available=false")
        return SeasonAnalysisResponse(
            available=False,
            detail=(
                f"{SEASON_FILENAME} is not available in this build. Fetch the season "
                "with app.services.season.fetch_season, then run "
                "physics.season_analysis.season_exposure and write the result here."
            ),
        )
    return SeasonAnalysisResponse(**json.loads(path.read_text()))


# serve the precomputed demo bands. never computes.
#
# This is the whole point of the split: the ensemble is minutes of work whose answer does
# not change between requests, so it is built once offline at a sample count no request
# thread could ever afford, and the live route only ever runs the deterministic solve.
@router.get("/demo-ensemble", response_model=DemoEnsembleResponse)
async def demo_ensemble() -> DemoEnsembleResponse:
    path = get_settings().cache_dir / DEMO_ENSEMBLE_FILENAME
    return DemoEnsembleResponse(
        **_load(
            path,
            "Run `python -m scripts.build_demo_ensemble` from backend/ to build it.",
        )
    )


# serve the validation summary. never computes.
@router.get("/validation", response_model=ValidationResponse)
async def validation() -> ValidationResponse:
    return ValidationResponse(
        **_load(
            get_settings().validation_path,
            "Run `pytest validation/ -m validation` to generate it.",
        )
    )
