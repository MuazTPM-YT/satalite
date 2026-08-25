import logging
from dataclasses import replace

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    AmbientRequest,
    AmbientResponse,
    AmbientSpec,
    PourWindowRequest,
    PourWindowResult,
    SimulationRequest,
    SimulationResult,
)
from app.services.fg_client import fetch_heatmap_async
from app.services.location import (
    coverage_box,
    credits_for,
    date_mode,
    is_day_cached,
    polygon_for,
    require_us,
)
from app.services.season import CREDITS_PER_CALL, cached_day, day_params, day_record
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
from physics.season_analysis import (
    PLACEMENT_ABOVE_AMBIENT_C,
    DayWeather,
    build_ambient,
)

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


# an hourly ambient for a stated place and day. This is where latitude enters the model.
#
# The studio used to solve one artifact's ambient and nothing else, so "location" was a
# caption. Here the latitude is handed straight to physics.season_analysis.build_ambient,
# which is what sets solar declination, sunset hour angle and daylength - so the solar
# term, and therefore the 4am-against-2pm comparison, genuinely follows the site. It is
# echoed back in the response the same way t_ref_c and probe_xy_m are, so no reader has
# to trust that it arrived.
#
# THIS ROUTE CAN SPEND MONEY. A site-day that is not already on disk costs 4220 credits.
# allow_live defaults to false, and the refusal names the price rather than paying it -
# a picker that fetched on every selection would empty the budget during a demo.
@router.post("/ambient", response_model=AmbientResponse)
async def ambient(request: AmbientRequest) -> AmbientResponse:
    try:
        box = require_us(request.lat, request.lon)
        mode = date_mode(request.date)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    cached = is_day_cached(request.lat, request.lon, request.date)
    if not cached and not request.allow_live:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{request.date} at ({request.lat:.4f}, {request.lon:.4f}) is not cached. "
                f"Fetching it costs {CREDITS_PER_CALL} credits. Send allow_live=true to "
                "spend them."
            ),
        )

    polygon = polygon_for(request.lat, request.lon)
    if cached:
        payload = cached_day(polygon, request.date)
    else:
        log.info(
            "live heatmap: %s at (%.4f, %.4f), %d credits",
            request.date, request.lat, request.lon, CREDITS_PER_CALL,
        )
        payload = await fetch_heatmap_async(day_params(polygon, request.date))

    record = day_record(request.date, payload)
    day = DayWeather(
        date=record["date"],
        day_of_year=record["day_of_year"],
        t_min_c=record["t_min_c"],
        t_mean_c=record["t_mean_c"],
        t_max_c=record["t_max_c"],
    )
    built = build_ambient(
        day, request.lat, request.placement_hour, hours=request.duration_hours
    )
    return AmbientResponse(
        ambient=AmbientSpec(
            hours_h=built.hours.tolist(),
            air_temp_c=built.air_temp_c.tolist(),
            rh_frac=built.rh_frac.tolist(),
            wind_ms=built.wind_ms.tolist(),
            cloud_pct=built.cloud_pct.tolist(),
            ghi_w_m2=built.ghi_w_m2.tolist(),
            sky_offset_c=built.sky_offset_c,
        ),
        resolved_lat_deg=request.lat,
        resolved_lon_deg=request.lon,
        resolved_date=request.date,
        resolved_placement_hour=request.placement_hour,
        coverage=box.name,
        mode=mode,
        source="cached" if cached else "live",
        credits_spent=0 if cached else CREDITS_PER_CALL,
        day_of_year=record["day_of_year"],
        t_min_c=record["t_min_c"],
        t_mean_c=record["t_mean_c"],
        t_max_c=record["t_max_c"],
    )


# what a site-day would cost, and whether it is in coverage. NEVER calls the API.
#
# The picker asks this on every selection, so it has to be free and it has to be quiet:
# an out-of-coverage point is a normal answer here, not an error, because the UI wants to
# grey a button rather than catch an exception on every keystroke.
@router.get("/ambient/quote", response_model=dict)
async def ambient_quote(
    lat: float = Query(ge=-90.0, le=90.0),
    lon: float = Query(ge=-180.0, le=180.0),
    date: str = Query(description="ISO day, e.g. 2025-07-15"),
) -> dict[str, object]:
    box = coverage_box(lat, lon)
    if box is None:
        return {
            "in_coverage": False,
            "reason": (
                f"({lat:.4f}, {lon:.4f}) is outside FortyGuard's coverage. The API "
                "answers for the United States only: the continental US, Alaska and Hawaii."
            ),
        }
    try:
        mode = date_mode(date)
    except ValueError as err:
        return {"in_coverage": True, "coverage": box.name, "reason": str(err)}
    cached = is_day_cached(lat, lon, date)
    return {
        "in_coverage": True,
        "coverage": box.name,
        "mode": mode,
        "cached": cached,
        "credits": credits_for(lat, lon, date),
    }
