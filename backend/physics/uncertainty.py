"""Monte Carlo over the parameters we genuinely do not know.

The point is not a prettier number, it is an honest band. A single deterministic run
of this solver reports a peak core temperature to a tenth of a degree while sitting on
a heat of hydration good to maybe +/- 8% and a surface film coefficient good to maybe a
factor of two. This module puts that spread on the screen instead of hiding it.

Reproducibility: every sample is drawn in the PARENT process from one seeded generator
before any work is dispatched. Workers receive finished numbers and draw nothing, so the
result does not depend on the pool size, the scheduling order, or the day of the week.
"""

import multiprocessing as mp
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import numpy as np

from physics import FloatArray
from physics.equations import maturity
from physics.solver import solve
from physics.strength_model import StrengthParams, params_for, strength_fraction
from physics.types import Ambient, Element, Mix, SolveResult

PERCENTILES = (5.0, 25.0, 50.0, 75.0, 95.0)
PERCENTILE_KEYS = ("p05", "p25", "p50", "p75", "p95")


@dataclass(frozen=True)
class ParamSample:
    """One draw from the joint parameter distribution. All independent."""

    placement_temp_offset_c: float   # added to the element's nominal placement temp
    h_multiplier: float              # scales the surface film, formed and free alike
    tau_h: float
    beta: float
    a_solar: float
    k_w_m_k: float
    rho_cp_j_m3_k: float             # sampled as the product; the solver only uses it so
    ea_j_mol: float
    h_cem_j_per_g: float
    forecast_z: float                # standard normal, scaled by lead-time sigma later


@dataclass(frozen=True)
class Ensemble:
    """Every sample's history on one shared time grid, plus what was fed in."""

    times_h: FloatArray
    core_temp_c: FloatArray          # (n, n_frames)
    surface_temp_c: FloatArray       # (n, n_frames)
    strength_fraction: FloatArray    # (n, n_frames)
    equivalent_age_h: FloatArray     # (n, n_frames)
    samples: list[ParamSample]
    seed: int
    dx_m: float

    @property
    def n_samples(self) -> int:
        return int(self.core_temp_c.shape[0])

    # p05/p25/p50/p75/p95 for each recorded quantity, over the sample axis.
    def percentiles(self) -> dict[str, dict[str, list[float]]]:
        fields = {
            "core_temp_c": self.core_temp_c,
            "surface_temp_c": self.surface_temp_c,
            "strength_fraction": self.strength_fraction,
            "equivalent_age_h": self.equivalent_age_h,
        }
        out: dict[str, dict[str, list[float]]] = {}
        for name, values in fields.items():
            bands = np.percentile(values, PERCENTILES, axis=0)
            out[name] = {key: bands[i].tolist() for i, key in enumerate(PERCENTILE_KEYS)}
        return out

    # peak core temperature per sample. the number the DEF check actually wants.
    def peak_core_temp_c(self) -> FloatArray:
        return np.asarray(self.core_temp_c.max(axis=1), dtype=np.float64)


# fork() inside a threaded process (uvicorn, pytest) can deadlock in the child, and
# CPython warns about exactly that. forkserver forks from a clean single-threaded helper
# instead, which is safe and costs about a second of startup over the whole ensemble.
#
# Do NOT call set_forkserver_preload here. Preloading these modules into the helper hangs
# the pool: workers stop being created and one process spins at 100% indefinitely.
# Measured, not theorised - 300 samples went from 56 s to still-running at 200 s.
#
# CALLER REQUIREMENT: a *script* that calls run_ensemble or season_exposure must put the
# call under `if __name__ == "__main__":`. Every non-fork start method re-imports the entry
# module in each worker, so an unguarded script tries to build a pool from inside its own
# workers. CPython catches it with a RuntimeError naming the missing guard. Irrelevant
# under uvicorn or pytest, where __main__ is not a user script.
def pool_context() -> mp.context.BaseContext:
    for method in ("forkserver", "spawn"):
        if method in mp.get_all_start_methods():
            return mp.get_context(method)
    return mp.get_context()


# sample the uncertain params. seeded, so demo repeats.
#
# tau_h_samples lets a caller supply tau from somewhere better than a 15% normal about
# the base - the validation harness derives it from sampled cement chemistry, where the
# Schindler-Folliard regression swings tau from 25.8 h to 15.2 h across a plausible SO3
# range alone. The internal tau draw still happens and is then discarded, so the rng
# stream stays in lockstep and every OTHER parameter is unchanged by the substitution.
def draw_parameters(
    base: Mix, n: int, seed: int = 0, tau_h_samples: Sequence[float] | None = None
) -> list[ParamSample]:
    rng = np.random.default_rng(seed)

    # placement temperature: normal sigma 3, truncated at +/- 3 sd rather than resampled,
    # because a resample loop would consume a variable number of draws and break the
    # one-stream reproducibility guarantee.
    placement_offset_c = np.clip(rng.normal(0.0, 3.0, n), -9.0, 9.0)

    # film coefficient: lognormal spanning 0.5x to 2.0x. Those bounds are read as the
    # 95% interval, so sigma_ln = ln(2)/2 puts each of them two sd from a median of 1.
    h_multiplier = np.clip(rng.lognormal(0.0, np.log(2.0) / 2.0, n), 0.5, 2.0)

    tau_h = rng.normal(base.tau_h, 0.15 * base.tau_h, n)
    beta = np.clip(rng.normal(base.beta, 0.10 * base.beta, n), 0.6, 1.4)
    a_solar = rng.uniform(0.50, 0.65, n)
    k_w_m_k = rng.normal(base.k_w_m_k, 0.075 * base.k_w_m_k, n)

    rho_cp_base = base.rho_kg_m3 * base.cp_j_kg_k
    rho_cp_j_m3_k = rng.normal(rho_cp_base, 0.075 * rho_cp_base, n)

    ea_j_mol = rng.uniform(33000.0, 42000.0, n)
    # centred on the mix's own cement heat, not the global default: a Type V mix
    # (450 J/g) perturbed about 500 would be handed 11% of heat it does not have.
    h_cem_j_per_g = rng.normal(base.h_cem_j_per_g, 0.08 * base.h_cem_j_per_g, n)
    forecast_z = rng.normal(0.0, 1.0, n)

    if tau_h_samples is not None:
        if len(tau_h_samples) != n:
            raise ValueError(
                f"tau_h_samples has {len(tau_h_samples)} entries, expected n={n}"
            )
        tau_h = np.asarray(tau_h_samples, dtype=np.float64)

    return [
        ParamSample(
            placement_temp_offset_c=float(placement_offset_c[i]),
            h_multiplier=float(h_multiplier[i]),
            tau_h=float(max(tau_h[i], 1e-3)),
            beta=float(beta[i]),
            a_solar=float(a_solar[i]),
            k_w_m_k=float(max(k_w_m_k[i], 1e-3)),
            rho_cp_j_m3_k=float(max(rho_cp_j_m3_k[i], 1e-3)),
            ea_j_mol=float(ea_j_mol[i]),
            h_cem_j_per_g=float(h_cem_j_per_g[i]),
            forecast_z=float(forecast_z[i]),
        )
        for i in range(n)
    ]


# one sample's Mix. h_u scales with cement heat, which is exact only at 100% OPC:
# the slag and fly-ash terms in the blend do not track H_cem. Slightly overstates the
# spread for heavily blended mixes, which is the safe direction.
def mix_for(base: Mix, sample: ParamSample) -> Mix:
    return Mix(
        cement_kg_m3=base.cement_kg_m3,
        h_u_j_per_kg=base.h_u_j_per_kg * (sample.h_cem_j_per_g / base.h_cem_j_per_g),
        alpha_u=base.alpha_u,
        tau_h=sample.tau_h,
        beta=sample.beta,
        h_cem_j_per_g=sample.h_cem_j_per_g,
        rho_kg_m3=base.rho_kg_m3,
        cp_j_kg_k=sample.rho_cp_j_m3_k / base.rho_kg_m3,
        k_w_m_k=sample.k_w_m_k,
    )


# forecast bias, fully correlated in time: one deviate per sample, widened by lead time.
#
# Hour-by-hour independent noise would be wrong here. It averages out over a 72 hour
# run and the band would collapse to nothing, when the real failure is a forecast that
# runs warm ALL AFTERNOON. One deviate scaled by sigma(lead) keeps that structure.
def shift_ambient(ambient: Ambient, z: float, sigma_by_hour_c: FloatArray | None) -> Ambient:
    if sigma_by_hour_c is None:
        return ambient
    return Ambient(
        hours=ambient.hours,
        air_temp_c=ambient.air_temp_c + z * sigma_by_hour_c,
        rh_frac=ambient.rh_frac,
        wind_ms=ambient.wind_ms,
        cloud_pct=ambient.cloud_pct,
        ghi_w_m2=ambient.ghi_w_m2,
        sky_offset_c=ambient.sky_offset_c,
    )


# ponytail: E_a is baked into equations/maturity.py as a module constant and that file is
# off limits, so the only way to vary it is to rebind the name for the duration of one
# solve. Process-local and restored on exit. If maturity ever grows an ea argument,
# delete this and pass it properly.
@contextmanager
def _activation_energy(ea_j_mol: float) -> Iterator[None]:
    # mypy: EA_BASE is imported into maturity from constants, so strict mode counts
    # reading it back off the module as an implicit re-export. Rebinding it is the
    # whole point of this helper.
    previous = maturity.EA_BASE  # type: ignore[attr-defined]
    maturity.EA_BASE = ea_j_mol  # type: ignore[attr-defined]
    try:
        yield
    finally:
        maturity.EA_BASE = previous  # type: ignore[attr-defined]


# one ensemble member. top level so multiprocessing can pickle it.
def _run_one(job: tuple[Element, Mix, Ambient, ParamSample, dict[str, Any]]) -> SolveResult:
    element, base_mix, ambient, sample, options = job
    perturbed = Element(
        shape=element.shape,
        dims_mm=element.dims_mm,
        dx_m=element.dx_m,
        placement_temp_c=element.placement_temp_c + sample.placement_temp_offset_c,
        formwork=element.formwork,
        on_ground=element.on_ground,
    )
    with _activation_energy(sample.ea_j_mol):
        return solve(
            perturbed,
            mix_for(base_mix, sample),
            ambient,
            solar_absorptivity=sample.a_solar,
            h_multiplier=sample.h_multiplier,
            **options,
        )


# run the ensemble. returns percentile bands.
def run_ensemble(
    element: Element,
    mix: Mix,
    ambient: Ambient,
    n: int = 300,
    seed: int = 0,
    dx_m: float = 0.02,
    hours: float = 72.0,
    dt_s: float = 30.0,
    record_every_s: float = 600.0,
    grade: str = "4000psi",
    forecast_sigma_c: dict[str, Any] | None = None,
    processes: int | None = None,
    adiabatic: bool = False,
    tau_h_samples: Sequence[float] | None = None,
) -> Ensemble:
    samples = draw_parameters(mix, n, seed, tau_h_samples)
    coarse = Element(
        shape=element.shape,
        dims_mm=element.dims_mm,
        dx_m=dx_m,
        placement_temp_c=element.placement_temp_c,
        formwork=element.formwork,
        on_ground=element.on_ground,
    )
    options = {
        "dt_s": dt_s,
        "hours": hours,
        "record_every_s": record_every_s,
        "adiabatic": adiabatic,
    }
    sigma_by_hour_c = _sigma_on_hours(forecast_sigma_c, ambient.hours)

    jobs = [
        (coarse, mix, shift_ambient(ambient, s.forecast_z, sigma_by_hour_c), s, options)
        for s in samples
    ]

    if processes == 1:
        results = [_run_one(job) for job in jobs]
    else:
        with pool_context().Pool(processes) as pool:
            results = pool.map(_run_one, jobs)

    params = params_for(grade)
    return _assemble(results, samples, params, seed, dx_m)


# lead-time sigma, resampled onto the ambient's own hour grid. flat past the last lead.
def _sigma_on_hours(
    forecast_sigma_c: dict[str, Any] | None, hours: FloatArray
) -> FloatArray | None:
    if forecast_sigma_c is None:
        return None
    lead_h = np.asarray(forecast_sigma_c["lead_h"], dtype=np.float64)
    sigma_c = np.asarray(forecast_sigma_c["sigma_c"], dtype=np.float64)
    return np.asarray(np.interp(hours, lead_h, sigma_c), dtype=np.float64)


# stack the per-sample histories. equivalent age is the section MINIMUM, because the
# coldest corner is what governs when the formwork can come off, not the average.
def _assemble(
    results: list[SolveResult],
    samples: list[ParamSample],
    params: StrengthParams,
    seed: int,
    dx_m: float,
) -> Ensemble:
    core_temp_c = np.asarray([r.core_temp_c for r in results], dtype=np.float64)
    surface_temp_c = np.asarray([r.surface_temp_c for r in results], dtype=np.float64)
    equivalent_age_h = np.asarray(
        [np.nanmin(r.t_e_h_frames, axis=(1, 2)) for r in results], dtype=np.float64
    )
    return Ensemble(
        times_h=results[0].times_h,
        core_temp_c=core_temp_c,
        surface_temp_c=surface_temp_c,
        strength_fraction=strength_fraction(equivalent_age_h, params),
        equivalent_age_h=equivalent_age_h,
        samples=samples,
        seed=seed,
        dx_m=dx_m,
    )


# probability of reaching target strength, as a function of time.
def strength_probability(ensemble: Ensemble, target_fraction: float = 0.75) -> FloatArray:
    return np.asarray(
        (ensemble.strength_fraction >= target_fraction).mean(axis=0), dtype=np.float64
    )


# time to reach a given confidence level. nan if the run never gets there.
def strip_time_h(
    ensemble: Ensemble, target_fraction: float = 0.75, confidence: float = 0.95
) -> float:
    probability = strength_probability(ensemble, target_fraction)
    reached = np.nonzero(probability >= confidence)[0]
    if reached.size == 0:
        return float("nan")
    return float(ensemble.times_h[reached[0]])
