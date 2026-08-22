"""The ensemble must be reproducible and its bands must be ordered. Nothing else here
is a physics claim - the physics is golden-tested, this checks the sampling machinery."""

import numpy as np
import pytest

from physics.equations import maturity
from physics.solver import solve, uniform_ambient
from physics.types import Element, Mix
from physics.uncertainty import (
    PERCENTILE_KEYS,
    draw_parameters,
    mix_for,
    run_ensemble,
    strength_probability,
    strip_time_h,
)

MIX = Mix(cement_kg_m3=400.0, h_u_j_per_kg=450e3, alpha_u=0.7, tau_h=15.1, beta=0.9)
SLAB = Element(
    shape="slab", dims_mm={"width": 400.0, "thickness": 300.0}, dx_m=0.04, placement_temp_c=25.0
)
AMBIENT = uniform_ambient(30.0, 12.0, wind_ms=2.0)

SMALL = {"n": 6, "hours": 6.0, "dx_m": 0.04, "dt_s": 30.0, "processes": 1}


# the demo cannot produce different numbers on different days
def test_same_seed_gives_identical_samples() -> None:
    assert draw_parameters(MIX, 50, seed=7) == draw_parameters(MIX, 50, seed=7)


def test_different_seed_gives_different_samples() -> None:
    assert draw_parameters(MIX, 50, seed=7) != draw_parameters(MIX, 50, seed=8)


# every clipped or bounded distribution actually stays inside its bounds
def test_samples_respect_their_bounds() -> None:
    samples = draw_parameters(MIX, 2000, seed=1)
    assert all(-9.0 <= s.placement_temp_offset_c <= 9.0 for s in samples)
    assert all(0.5 <= s.h_multiplier <= 2.0 for s in samples)
    assert all(0.6 <= s.beta <= 1.4 for s in samples)
    assert all(0.50 <= s.a_solar <= 0.65 for s in samples)
    assert all(33000.0 <= s.ea_j_mol <= 42000.0 for s in samples)
    assert all(s.tau_h > 0.0 and s.k_w_m_k > 0.0 and s.rho_cp_j_m3_k > 0.0 for s in samples)


# H_cem is the largest driver of peak core temperature, so it must actually vary
def test_h_cem_is_sampled_and_reaches_the_mix() -> None:
    samples = draw_parameters(MIX, 200, seed=2)
    heats = {mix_for(MIX, s).h_u_j_per_kg for s in samples}
    assert len(heats) == len(samples), "h_u must differ per sample"
    assert np.std([s.h_cem_j_per_g for s in samples]) > 20.0  # ~8% of 500


# a Type V mix perturbed about the global 500 would be handed 11% of heat it has not got
def test_h_cem_is_sampled_around_the_mix_not_the_global_default() -> None:
    cool = Mix(cement_kg_m3=400.0, h_u_j_per_kg=450e3, alpha_u=0.7, tau_h=15.1,
               beta=0.9, h_cem_j_per_g=450.0)
    heats = [s.h_cem_j_per_g for s in draw_parameters(cool, 500, seed=4)]
    assert np.mean(heats) == pytest.approx(450.0, abs=8.0)
    # and scaling h_u must be a no-op at the mean, not a 450/500 haircut
    unshifted = [s for s in draw_parameters(cool, 500, seed=4) if s.h_cem_j_per_g > 449.9]
    assert mix_for(cool, unshifted[0]).h_u_j_per_kg == pytest.approx(
        450e3 * unshifted[0].h_cem_j_per_g / 450.0
    )


# rho*cp is sampled as a product, so cp carries it and rho stays put
def test_rho_cp_product_is_what_varies() -> None:
    sample = draw_parameters(MIX, 1, seed=3)[0]
    perturbed = mix_for(MIX, sample)
    assert perturbed.rho_kg_m3 == MIX.rho_kg_m3
    assert perturbed.rho_kg_m3 * perturbed.cp_j_kg_k == pytest.approx(sample.rho_cp_j_m3_k)


# the solver hook the ensemble leans on has to be live, not silently ignored.
# Air is held well BELOW the placement temperature so heat can only ever leave: with a
# warmer ambient a bigger film pumps heat IN and the sign flips, which says nothing
# about whether the hook works.
def test_h_multiplier_changes_the_answer() -> None:
    cold_air = uniform_ambient(10.0, 12.0, wind_ms=2.0)
    well_cooled = solve(SLAB, MIX, cold_air, hours=8.0, dt_s=30.0, h_multiplier=2.0)
    insulated = solve(SLAB, MIX, cold_air, hours=8.0, dt_s=30.0, h_multiplier=0.5)
    assert well_cooled.peak_core_temp_c < insulated.peak_core_temp_c


# activation energy is rebound around one solve. it must not leak out of it.
def test_ensemble_restores_the_activation_energy_constant() -> None:
    before = maturity.EA_BASE
    run_ensemble(SLAB, MIX, AMBIENT, seed=0, **SMALL)
    assert maturity.EA_BASE == before


def test_ensemble_is_reproducible() -> None:
    first = run_ensemble(SLAB, MIX, AMBIENT, seed=0, **SMALL)
    second = run_ensemble(SLAB, MIX, AMBIENT, seed=0, **SMALL)
    assert np.array_equal(first.core_temp_c, second.core_temp_c)
    assert np.array_equal(first.strength_fraction, second.strength_fraction)


# pool size must not change the result, or "seeded" means nothing
def test_pool_size_does_not_change_the_result() -> None:
    serial = run_ensemble(SLAB, MIX, AMBIENT, seed=4, **SMALL)
    parallel = run_ensemble(SLAB, MIX, AMBIENT, seed=4, **{**SMALL, "processes": 2})
    assert np.array_equal(serial.core_temp_c, parallel.core_temp_c)


def test_percentile_bands_are_ordered() -> None:
    bands = run_ensemble(SLAB, MIX, AMBIENT, seed=0, **SMALL).percentiles()
    for quantity, values in bands.items():
        stacked = np.asarray([values[key] for key in PERCENTILE_KEYS])
        assert np.all(np.diff(stacked, axis=0) >= -1e-9), f"{quantity} bands out of order"


def test_strength_probability_is_a_probability_and_never_falls() -> None:
    ensemble = run_ensemble(SLAB, MIX, AMBIENT, seed=0, **SMALL)
    probability = strength_probability(ensemble, target_fraction=0.05)
    assert probability.shape == ensemble.times_h.shape
    assert np.all((probability >= 0.0) & (probability <= 1.0))
    # equivalent age only ever accumulates, so the probability can only ever rise
    assert np.all(np.diff(probability) >= 0.0)


def test_strip_time_is_a_recorded_time_or_nan() -> None:
    ensemble = run_ensemble(SLAB, MIX, AMBIENT, seed=0, **SMALL)
    unreachable = strip_time_h(ensemble, target_fraction=0.75)
    assert np.isnan(unreachable), "6 hours cannot reach 75% of f'c"

    easy = strip_time_h(ensemble, target_fraction=0.01, confidence=0.5)
    assert easy in set(ensemble.times_h.tolist())


# forking a threaded process can deadlock the child. the pool must not use fork.
def test_pool_never_forks_a_threaded_parent() -> None:
    from physics.uncertainty import pool_context

    assert pool_context().get_start_method() != "fork"
