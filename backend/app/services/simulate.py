"""Marshals API specs into physics types and back. All the glue, none of the physics.

physics/ knows nothing about this module, and that is the point: everything here is
translation and presentation, so the solver can be reviewed without reading a line of
web code.
"""

import logging
from dataclasses import replace
from typing import Any

import numpy as np

from app.models import (
    AmbientSpec,
    Bands,
    BreachFlags,
    ElementSpec,
    EnsembleResult,
    FieldFrames,
    MixSpec,
    PourWindowCandidate,
    SimulationResult,
    TrippedBy,
)
from physics.constants import (
    CRACK_LIMIT_C,
    DEF_LIMIT_C,
    H_CEM_BY_TYPE,
    H_CEM_DEFAULT,
    PLACEMENT_MAX_C,
    STRIP_FRACTION,
    T_REF_DEFAULT_C,
)
from physics.forecast_error import provisional_error
from physics.limits import (
    EVAP_LIMIT_KG_M2_H,
    breaches_cracking,
    breaches_def,
    breaches_evaporation,
    breaches_placement,
)
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
        probe_xy_m=None if spec.probe_xy_m is None else (spec.probe_xy_m[0], spec.probe_xy_m[1]),
    )


# cement heat for a stated ASTM C150 type. unknown type keeps the global default.
def h_cem_for(cement_type: str | None) -> float:
    return H_CEM_DEFAULT if cement_type is None else H_CEM_BY_TYPE[cement_type]


# spec in, physics Mix out. "standard" is the season-analysis mix, unchanged.
#
# A stated cement_type rescales the standard mix's ultimate heat by the ratio of type
# heats. h_u is linear in H_cem for the clinker fraction, and the fly-ash CaO term does
# not track it, so this slightly overstates the shift for a heavily blended mix - in the
# conservative direction for a low-C3A type, which is the one worth being careful about.
def to_mix(spec: MixSpec) -> Mix:
    base = standard_mix()
    if spec.mix_id == "standard" and spec.cement_kg_m3 is None:
        h_cem = h_cem_for(spec.cement_type)
        if h_cem == base.h_cem_j_per_g:
            return base
        return replace(
            base,
            h_u_j_per_kg=base.h_u_j_per_kg * (h_cem / base.h_cem_j_per_g),
            h_cem_j_per_g=h_cem,
        )
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
        h_cem_j_per_g=h_cem_for(spec.cement_type),
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


# every threshold this run crosses, with the threshold alongside it. The comparisons come
# from physics.limits, never from an inline repeat of them - this used to re-implement all
# four, so a limit could move in one place and not the other.
def to_breaches(
    peak_core_temp_c: float,
    max_core_temp_anywhere_c: float,
    max_diff_c: float,
    max_anywhere_diff_c: float,
    peak_evap_kg_m2_h: float,
    placement_temp_c: float,
) -> BreachFlags:
    # The unconditional 155 degF design maximum. limits.def_threshold_c can relax it for
    # a cement whose S/A and S2/A resist DEF, but MixSpec carries no alumina content, so
    # relaxing here would mean relaxing a safety limit on a number nobody supplied.
    threshold_c = DEF_LIMIT_C
    # flag on EITHER. The probe sits at a nominal point; the hottest cell is where DEF
    # actually happens, and on a 300 mm slab the two differ by about 4 C.
    def_by_probe = bool(breaches_def(peak_core_temp_c, threshold_c))
    def_by_anywhere = bool(breaches_def(max_core_temp_anywhere_c, threshold_c))
    # same treatment for cracking, for the same reason. The probe-based differential is
    # the LESS conservative of the two - on a 300 mm slab it reads about 4.5 C low - so
    # evaluating the flag on it alone was the DEF defect wearing a different name.
    crack_by_probe = bool(breaches_cracking(max_diff_c))
    crack_by_anywhere = bool(breaches_cracking(max_anywhere_diff_c))
    return BreachFlags(
        def_risk=def_by_probe or def_by_anywhere,
        def_threshold_c=threshold_c,
        def_tripped_by=_tripped_by(def_by_probe, def_by_anywhere),
        cracking=crack_by_probe or crack_by_anywhere,
        cracking_limit_c=CRACK_LIMIT_C,
        cracking_tripped_by=_tripped_by(crack_by_probe, crack_by_anywhere),
        evaporation=bool(breaches_evaporation(peak_evap_kg_m2_h / 3600.0)),
        evaporation_limit_kg_m2_h=EVAP_LIMIT_KG_M2_H,
        placement=bool(breaches_placement(placement_temp_c)),
        placement_limit_c=PLACEMENT_MAX_C,
    )


# name which quantity crossed a limit, so a reader is never left guessing. Shared by the
# DEF and cracking flags - both ask the same probe-vs-hottest-point question.
def _tripped_by(by_probe: bool, by_anywhere: bool) -> TrippedBy:
    if by_probe and by_anywhere:
        return "both"
    if by_anywhere:
        return "max_anywhere"
    return "probe" if by_probe else "none"


# nan is not valid json. a time that was never reached is null, never a made-up number.
def _or_none(value: float) -> float | None:
    return None if np.isnan(value) else float(value)


# thin the recorded frames down to something a browser can hold, and pack them.
#
# The FRAME axis is the only one thinned. x and y are handed over exactly as solved,
# because a resampled cell is a number the solver never computed. Frame 0, the peak-core
# frame and the last frame are always kept whatever the stride: the peak is the one a
# caller checks the probe against, and dropping it would make peak_core_temp_c
# unreproducible from the field it came from.
def to_field_frames(result: SolveResult, dx_m: float, stride_h: float) -> FieldFrames:
    n_frames, ny, nx = result.temp_c_frames.shape
    frame_dt_h = (
        float(result.times_h[1] - result.times_h[0]) if n_frames > 1 else 0.0
    )
    step = max(int(round(stride_h / frame_dt_h)), 1) if frame_dt_h > 0.0 else 1

    keep = set(range(0, n_frames, step))
    keep.add(0)
    keep.add(n_frames - 1)
    keep.add(int(np.argmax(result.core_temp_c)))
    indices = sorted(keep)

    # nan is not valid json and it is not zero either. Outside the mask there is no
    # concrete, so there is no temperature - null says that and a number would lie.
    frames = np.round(result.temp_c_frames[indices], 2)
    temp_c = [
        [[None if np.isnan(v) else float(v) for v in row] for row in frame]
        for frame in frames
    ]
    return FieldFrames(
        nx=nx,
        ny=ny,
        dx_m=dx_m,
        times_h=[float(result.times_h[i]) for i in indices],
        frame_indices=indices,
        temp_c=temp_c,
    )


# one deterministic solve, packaged for the wire.
def run_deterministic(
    element: Element,
    mix: Mix,
    ambient: Ambient,
    hours: float,
    grade: str,
    t_ref_c: float = T_REF_DEFAULT_C,
) -> tuple[SolveResult, SimulationResult]:
    result = solve(element, mix, ambient, hours=hours, t_ref_c=t_ref_c)
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
        max_anywhere_surface_diff_c=result.max_anywhere_surface_diff_c,
        max_core_temp_anywhere_c=result.max_core_temp_anywhere_c,
        probe_xy_m=list(result.probe_xy_m),
        t_ref_c=t_ref_c,
        peak_evaporation_kg_m2_h=peak_evap_kg_m2_h,
        strip_time_h=_or_none(deterministic_strip_time_h(result, grade)),
        breaches=to_breaches(
            result.peak_core_temp_c,
            result.max_core_temp_anywhere_c,
            result.max_core_surface_diff_c,
            result.max_anywhere_surface_diff_c,
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
        max_core_temp_anywhere_c=payload.max_core_temp_anywhere_c,
        max_core_surface_diff_c=payload.max_core_surface_diff_c,
        max_anywhere_surface_diff_c=payload.max_anywhere_surface_diff_c,
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
    t_ref_c: float = T_REF_DEFAULT_C,
) -> EnsembleResult:
    forecast_error = provisional_error()
    log.info("ensemble n=%d seed=%d grade=%s t_ref=%.1f C", n, seed, grade, t_ref_c)
    ensemble = run_ensemble(
        element,
        mix,
        ambient,
        n=n,
        seed=seed,
        hours=hours,
        grade=grade,
        forecast_sigma_c=forecast_error,
        t_ref_c=t_ref_c,
    )
    return to_ensemble_result(ensemble, forecast_error)
