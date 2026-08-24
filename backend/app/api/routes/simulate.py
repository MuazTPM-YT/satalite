import logging
from dataclasses import replace

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    PourWindowRequest,
    PourWindowResult,
    SimulationRequest,
    SimulationResult,
)
from app.services.simulate import (
    best_candidate,
    run_bands,
    run_deterministic,
    to_ambient,
    to_candidate,
    to_element,
    to_field_frames,
    to_mix,
)
from physics.season_analysis import PLACEMENT_ABOVE_AMBIENT_C

log = logging.getLogger(__name__)

router = APIRouter(tags=["simulate"])


# run the cure. physics does the work, this only marshals.
@router.post("/simulate", response_model=SimulationResult)
async def simulate(
    request: SimulationRequest,
    ensemble: bool = Query(default=False, description="add p05/p50/p95 bands"),
    samples: int = Query(default=300, ge=1, le=2000),
    seed: int = Query(default=0),
    # OFF by default and it must stay that way. The full frame stack is tens of megabytes
    # on a realistic slab; the caller has to ask, and gets to say how thinly.
    fields: bool = Query(default=False, description="add the per-cell temperature field"),
    fields_stride_h: float = Query(
        default=1.0, gt=0.0, le=24.0, description="hours between kept field frames"
    ),
) -> SimulationResult:
    try:
        element, mix = to_element(request.element), to_mix(request.mix)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    ambient = to_ambient(request.ambient)
    result, payload = run_deterministic(
        element, mix, ambient, request.duration_hours, request.mix.grade, request.t_ref_c
    )
    if fields:
        payload.fields = to_field_frames(result, element.dx_m, fields_stride_h)
    if ensemble:
        payload.ensemble = run_bands(
            element, mix, ambient, request.duration_hours, request.mix.grade,
            samples, seed, request.t_ref_c,
        )
    return payload


# deterministic per candidate hour, ensemble on the pick.
@router.post("/pour-windows", response_model=PourWindowResult)
async def pour_windows(request: PourWindowRequest) -> PourWindowResult:
    try:
        element, mix = to_element(request.element), to_mix(request.mix)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    candidates = []
    for offset_h in request.candidate_offsets_h:
        shifted = to_ambient(request.ambient, offset_h)
        # placed at whatever the air is doing at that hour: the whole point of the sweep
        placed = replace(
            element,
            placement_temp_c=float(shifted.air_temp_c[0]) + PLACEMENT_ABOVE_AMBIENT_C,
        )
        _, payload = run_deterministic(
            placed, mix, shifted, request.duration_hours, request.mix.grade, request.t_ref_c
        )
        candidates.append(to_candidate(offset_h, placed, payload))

    pick = best_candidate(candidates)
    log.info("pour window pick offset_h=%.1f breaches=%d", pick.offset_h, pick.n_breaches)

    # the sweep is the answer; the band is opt-in. Running it unconditionally put a
    # minute of solving on a request thread that only ever needed seconds of it.
    ensemble = None
    if request.ensemble:
        ensemble = run_bands(
            element,
            mix,
            to_ambient(request.ambient, pick.offset_h),
            request.duration_hours,
            request.mix.grade,
            request.ensemble_samples,
            request.seed,
            request.t_ref_c,
        )

    return PourWindowResult(
        candidates=candidates, best_offset_h=pick.offset_h, ensemble=ensemble
    )
