"""Marshals API specs into physics types and back. All the glue, none of the physics.

physics/ knows nothing about this module, and that is the point: everything here is
translation and presentation, so the solver can be reviewed without reading a line of
web code.
"""

import logging
from typing import Any

import numpy as np

from app.models import (
    AmbientSpec,
    Bands,
    BreachFlags,
    ElementSpec,
    EnsembleResult,
    MixSpec,
    PourWindowCandidate,
    SimulationResult,
)
from physics.constants import CRACK_LIMIT_C, DEF_LIMIT_C, PLACEMENT_MAX_C, STRIP_FRACTION
from physics.forecast_error import provisional_error
from physics.limits import EVAP_LIMIT_KG_M2_H
from physics.season_analysis import (
    deterministic_strip_time_h,
    evaporation_series_kg_m2_s,
    standard_mix,
)
from physics.solver import solve
from physics.strength_model import params_for, strength_fraction
from physics.types import Ambient, Element, Mix, SolveResult
from physics.uncertainty import Ensemble, run_ensemble, strength_probability, strip_time_h

log = logging.getLogger(__name__)

# spec in, physics Element out.
def to_element(spec: ElementSpec) -> Element:
    return Element(
        shape=spec.shape,
        dims_mm=dict(spec.dims_mm),
        dx_m=spec.dx_m,
        placement_temp_c=spec.placement_temp_c,
        formwork=spec.formwork,
        on_ground=spec.on_ground,
    )


# spec in, physics Mix out. "standard" is the season-analysis mix, unchanged.
def to_mix(spec: MixSpec) -> Mix:
    base = standard_mix()
    if spec.mix_id == "standard" and spec.cement_kg_m3 is None:
        return base
    if spec.mix_id != "standard" and spec.cement_kg_m3 is None:
        raise ValueError(
            f"unknown mix_id {spec.mix_id!r}. Either use 'standard' or supply "
            "cement_kg_m3, h_u_j_per_kg, alpha_u and tau_h explicitly."
        )
    missing = [
        name
        for name in ("cement_kg_m3", "h_u_j_per_kg", "alpha_u", "tau_h")
        if getattr(spec, name) is None
    ]
    if missing:
        raise ValueError(f"custom mix is missing {missing}")
    return Mix(
        cement_kg_m3=float(spec.cement_kg_m3),      # type: ignore[arg-type]
        h_u_j_per_kg=float(spec.h_u_j_per_kg),      # type: ignore[arg-type]
        alpha_u=float(spec.alpha_u),                # type: ignore[arg-type]
        tau_h=float(spec.tau_h),                    # type: ignore[arg-type]
        beta=float(spec.beta) if spec.beta is not None else base.beta,
    )


# spec in, physics Ambient out. offset_h slides the start of the run along the series.
def to_ambient(spec: AmbientSpec, offset_h: float = 0.0) -> Ambient:
    return Ambient(
        hours=np.asarray(spec.hours_h, dtype=np.float64) - offset_h,
        air_temp_c=np.asarray(spec.air_temp_c, dtype=np.float64),
        rh_frac=np.asarray(spec.rh_frac, dtype=np.float64),
        wind_ms=np.asarray(spec.wind_ms, dtype=np.float64),
        cloud_pct=np.asarray(spec.cloud_pct, dtype=np.float64),
        ghi_w_m2=np.asarray(spec.ghi_w_m2, dtype=np.float64),
        sky_offset_c=spec.sky_offset_c,
    )


# every threshold this run crosses, with the threshold alongside it.
def to_breaches(
    peak_core_temp_c: float,
    max_diff_c: float,
    peak_evap_kg_m2_h: float,
    placement_temp_c: float,
) -> BreachFlags:
    # The unconditional 155 degF design maximum. limits.def_threshold_c can relax it for
    # a cement whose S/A and S2/A resist DEF, but MixSpec carries no alumina content, so
    # relaxing here would mean relaxing a safety limit on a number nobody supplied.
    threshold_c = DEF_LIMIT_C
    return BreachFlags(
        def_risk=peak_core_temp_c > threshold_c,
        def_threshold_c=threshold_c,
        cracking=max_diff_c > CRACK_LIMIT_C,
        cracking_limit_c=CRACK_LIMIT_C,
        evaporation=peak_evap_kg_m2_h > EVAP_LIMIT_KG_M2_H,
        evaporation_limit_kg_m2_h=EVAP_LIMIT_KG_M2_H,
        placement=placement_temp_c > PLACEMENT_MAX_C,
        placement_limit_c=PLACEMENT_MAX_C,
    )


# nan is not valid json. a time that was never reached is null, never a made-up number.
def _or_none(value: float) -> float | None:
    return None if np.isnan(value) else float(value)


# one deterministic solve, packaged for the wire.
def run_deterministic(
    element: Element, mix: Mix, ambient: Ambient, hours: float, grade: str
) -> tuple[SolveResult, SimulationResult]:
    result = solve(element, mix, ambient, hours=hours)
    weakest_t_e_h = np.nanmin(result.t_e_h_frames, axis=(1, 2))
    peak_evap_kg_m2_h = float(np.max(evaporation_series_kg_m2_s(result, ambient)) * 3600.0)

    payload = SimulationResult(
        times_h=result.times_h.tolist(),
        core_temp_c=result.core_temp_c.tolist(),
        surface_temp_c=result.surface_temp_c.tolist(),
        equivalent_age_h=weakest_t_e_h.tolist(),
        strength_fraction=strength_fraction(weakest_t_e_h, params_for(grade)).tolist(),
        peak_core_temp_c=result.peak_core_temp_c,
        peak_core_time_h=result.peak_core_time_h,
        max_core_surface_diff_c=result.max_core_surface_diff_c,
        peak_evaporation_kg_m2_h=peak_evap_kg_m2_h,
        strip_time_h=_or_none(deterministic_strip_time_h(result, grade)),
        breaches=to_breaches(
            result.peak_core_temp_c,
            result.max_core_surface_diff_c,
            peak_evap_kg_m2_h,
            element.placement_temp_c,
        ),
        outline_m=result.outline_m,
    )
    return result, payload


# same run as a pour-window candidate row.
def to_candidate(
    offset_h: float, element: Element, payload: SimulationResult
) -> PourWindowCandidate:
    breaches = payload.breaches
    return PourWindowCandidate(
        offset_h=offset_h,
        placement_temp_c=element.placement_temp_c,
        peak_core_temp_c=payload.peak_core_temp_c,
        max_core_surface_diff_c=payload.max_core_surface_diff_c,
        peak_evaporation_kg_m2_h=payload.peak_evaporation_kg_m2_h,
        strip_time_h=payload.strip_time_h,
        breaches=breaches,
        n_breaches=sum(
            [breaches.def_risk, breaches.cracking, breaches.evaporation, breaches.placement]
        ),
    )


# fewest breaches wins; ties broken on the cooler core. deterministic, no randomness.
def best_candidate(candidates: list[PourWindowCandidate]) -> PourWindowCandidate:
    return min(candidates, key=lambda c: (c.n_breaches, c.peak_core_temp_c))


# ensemble bands for the wire. forecast_error is echoed so the caller sees if it is
# the PROVISIONAL default rather than measured skill.
def to_ensemble_result(
    ensemble: Ensemble, forecast_error: dict[str, Any], target_fraction: float = STRIP_FRACTION
) -> EnsembleResult:
    bands = ensemble.percentiles()
    return EnsembleResult(
        n_samples=ensemble.n_samples,
        seed=ensemble.seed,
        dx_m=ensemble.dx_m,
        core_temp_c=Bands(**bands["core_temp_c"]),
        surface_temp_c=Bands(**bands["surface_temp_c"]),
        strength_fraction=Bands(**bands["strength_fraction"]),
        equivalent_age_h=Bands(**bands["equivalent_age_h"]),
        strength_probability=strength_probability(ensemble, target_fraction).tolist(),
        strip_time_h_p95=_or_none(strip_time_h(ensemble, target_fraction, confidence=0.95)),
        forecast_error=forecast_error,
    )


# run the ensemble and package it. forecast sigma widens the ambient with lead time.
def run_bands(
    element: Element,
    mix: Mix,
    ambient: Ambient,
    hours: float,
    grade: str,
    n: int,
    seed: int,
) -> EnsembleResult:
    forecast_error = provisional_error()
    log.info("ensemble n=%d seed=%d grade=%s", n, seed, grade)
    ensemble = run_ensemble(
        element,
        mix,
        ambient,
        n=n,
        seed=seed,
        hours=hours,
        grade=grade,
        forecast_sigma_c=forecast_error,
    )
    return to_ensemble_result(ensemble, forecast_error)
