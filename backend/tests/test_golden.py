"""Four golden physics tests. Every one is a known-answer check against a result
that does not depend on our implementation: a closed-form limit, an analytical
solution, an identity, or a conservation law.

They are skipped until physics/ is built. Do not delete them, do not loosen the
tolerances to make them pass, and do not "fix" the expected values — if the
solver disagrees with these, the solver is wrong.

Comments here are deliberately fuller than the rest of the codebase, because
these encode the physics and a misreading here produces confidently wrong
output everywhere downstream.
"""

import numpy as np
import pytest

from physics import conduction, geometry, hydration, maturity, mixes

pytestmark = pytest.mark.skip(reason="physics not built")

# A representative structural mix. 400 kg/m3 cement is a normal mid-range dose.
CEMENT_KG_M3 = 400.0
HU_J_PER_G = 450.0     # total heat of hydration per gram of cement
ALPHA_U = 0.7          # ultimate degree of hydration - cement never fully reacts
RHO_KG_M3 = 2400.0     # concrete density
CP_J_KG_C = 1000.0     # concrete specific heat, per degree celsius


def test_adiabatic_temperature_rise() -> None:
    """With every loss switched off, all hydration heat stays in the concrete.

    The total rise is then a pure energy bookkeeping result, independent of the
    solver's grid, timestep, or boundary code:

        dT = H_u * C_c * alpha_u / (rho * c_p)

    Units: H_u [J/g] * 1000 [g/kg] * C_c [kg/m3] * alpha_u  ->  J/m3,
    divided by rho [kg/m3] * c_p [J/(kg*C)] -> J/(m3*C), leaving degrees C.

        450 * 1000 * 400 * 0.7 / (2400 * 1000) = 52.5 C

    Independent sanity check: the field rule of thumb is a 12-14 C rise per
    100 kg/m3 of cement, so 400 kg/m3 should land in 48-56 C. 52.5 sits mid-band,
    which is why we trust the closed form rather than the solver here.
    """
    mix = mixes.get_mix("golden-400")

    expected_rise_c = (HU_J_PER_G * 1000.0 * CEMENT_KG_M3 * ALPHA_U) / (RHO_KG_M3 * CP_J_KG_C)
    assert 48.0 <= expected_rise_c <= 56.0  # guards the constants above, not the solver

    # The mix's own closed form must agree with the hand calculation.
    assert hydration.adiabatic_rise_c(mix) == pytest.approx(expected_rise_c, rel=1e-9)

    # And the solver, run adiabatically, must converge to the same number.
    # h_eff = 0 on every face means no convection, no radiation, no formwork loss.
    grid = geometry.rasterise("slab", width_m=2.0, height_m=0.5, cell_size_m=0.025)
    placement_temp_c = 20.0
    no_loss = dict.fromkeys(("top", "bottom", "left", "right"), 0.0)

    # Long run so hydration effectively finishes: 28 days.
    history_c = conduction.solve(
        grid=grid,
        mix=mix,
        placement_temp_c=placement_temp_c,
        ambient_temp_c=np.full(28 * 24, 20.0),
        dt_s=60.0,
        duration_s=28 * 24 * 3600.0,
        h_eff_w_m2_c=no_loss,
        seed=0,
    )

    final_c = float(history_c[-1][grid.mask].mean())
    assert final_c - placement_temp_c == pytest.approx(expected_rise_c, rel=0.02)

    # Adiabatic means uniform: with no losses there is nowhere for a gradient to come from.
    assert float(history_c[-1][grid.mask].ptp()) < 0.01


def test_no_hydration_decays_to_analytical_solution() -> None:
    """Kill the heat source and the solver is just the heat equation.

    A semi-infinite solid at initial temperature T_i, with its surface held at
    T_amb from t=0, has the exact solution

        T(x, t) = T_amb + (T_i - T_amb) * erf( x / (2 * sqrt(alpha * t)) )

    where alpha = k / (rho * c_p) is the thermal diffusivity. Any correct
    finite-difference conduction scheme must reproduce this to within
    discretisation error - this is what separates a solver from a curve fit.
    """
    from scipy.special import erf

    mix = mixes.get_mix("golden-inert")  # Q = 0, no hydration heat at all
    initial_temp_c = 40.0
    ambient_temp_c = 10.0

    # Deep enough that the far boundary never sees the thermal wave in 6 hours,
    # which is what makes the semi-infinite solution applicable.
    grid = geometry.rasterise("wall", width_m=0.02, height_m=2.0, cell_size_m=0.005)
    elapsed_s = 6 * 3600.0

    # Very large h_eff pins the surface to ambient, matching the analytical BC.
    history_c = conduction.solve(
        grid=grid,
        mix=mix,
        placement_temp_c=initial_temp_c,
        ambient_temp_c=np.full(6, ambient_temp_c),
        dt_s=1.0,
        duration_s=elapsed_s,
        h_eff_w_m2_c={"top": 1e6, "bottom": 0.0, "left": 0.0, "right": 0.0},
        seed=0,
    )

    alpha_m2_s = mix.conductivity_w_m_c / (mix.density_kg_m3 * mix.specific_heat_j_kg_c)
    depth_m = np.arange(grid.mask.shape[0]) * grid.cell_size_m
    analytical_c = ambient_temp_c + (initial_temp_c - ambient_temp_c) * erf(
        depth_m / (2.0 * np.sqrt(alpha_m2_s * elapsed_s))
    )

    numerical_c = history_c[-1][:, grid.mask.shape[1] // 2]
    # 0.5 C is generous for a 5 mm grid but catches sign errors, factor-of-two
    # errors in alpha, and off-by-one indexing at the boundary.
    assert np.max(np.abs(numerical_c - analytical_c)) < 0.5

    # Sanity: with no heat source, nothing may end up hotter than it started.
    assert float(history_c[-1].max()) <= initial_temp_c + 1e-9


def test_maturity_identities_at_constant_temperature() -> None:
    """At constant temperature both maturity functions collapse to identities.

    Nurse-Saul is a plain integral of (T - T0) dt, so holding T constant for a
    duration t must return exactly (T - T0) * t. No approximation is involved,
    hence the exact comparison.

    Arrhenius equivalent age reweights real time by
        exp( -E/R * (1/T - 1/T_ref) )   [T in kelvin]
    so at T = T_ref the exponent is exactly zero, the weight is exactly 1, and
    the equivalent age must equal the elapsed time exactly. If this drifts, the
    celsius-to-kelvin conversion is wrong - the single most common bug in
    maturity code.
    """
    dt_h = 1.0
    hours = 24
    activation_energy_j_mol = 33500.0  # typical ASTM C1074 value for Type I cement

    held_temp_c = 30.0
    temps_c = np.full(hours, held_temp_c)

    # Nurse-Saul: exact, so exact equality (bar float representation).
    expected_c_hours = (held_temp_c - maturity.DATUM_TEMP_C) * hours * dt_h
    assert maturity.nurse_saul_c_hours(temps_c, dt_h) == pytest.approx(
        expected_c_hours, rel=1e-12
    )

    # Arrhenius at exactly the reference temperature: equivalent age == real time.
    at_ref_c = np.full(hours, maturity.REF_TEMP_C)
    assert maturity.equivalent_age_h(
        at_ref_c, dt_h, activation_energy_j_mol
    ) == pytest.approx(hours * dt_h, rel=1e-12)

    # Direction check: hotter than reference must age the concrete faster, colder slower.
    hot = maturity.equivalent_age_h(
        np.full(hours, maturity.REF_TEMP_C + 15.0), dt_h, activation_energy_j_mol
    )
    cold = maturity.equivalent_age_h(
        np.full(hours, maturity.REF_TEMP_C - 15.0), dt_h, activation_energy_j_mol
    )
    assert cold < hours * dt_h < hot


def test_energy_balance_every_timestep() -> None:
    """First law, checked every single timestep, not just at the end.

        heat generated == heat stored + heat lost through all faces

    An end-of-run check can hide errors that cancel; a per-step check cannot.
    This is the test that catches a mis-scaled source term, a boundary flux
    applied over the wrong face area, or a timestep used twice.
    """
    mix = mixes.get_mix("golden-400")
    grid = geometry.rasterise("column", width_m=0.6, height_m=0.6, cell_size_m=0.02)

    dt_s = min(60.0, conduction.max_stable_dt_s(grid, mix))
    temp_c = np.where(grid.mask, 20.0, np.nan)
    ambient_temp_c = 15.0
    h_eff = dict.fromkeys(("top", "bottom", "left", "right"), 10.0)

    for step_index in range(200):
        source_w_m3 = hydration.heat_generation_w_m3(
            mix, np.full(temp_c.shape, step_index * dt_s / 3600.0), temp_c
        )
        result = conduction.step(
            temp_c=temp_c,
            grid=grid,
            mix=mix,
            dt_s=dt_s,
            source_w_m3=source_w_m3,
            ambient_temp_c=ambient_temp_c,
            h_eff_w_m2_c=h_eff,
        )

        residual_j = result.heat_generated_j - (result.heat_stored_j + result.heat_lost_j)
        scale_j = max(abs(result.heat_generated_j), abs(result.heat_stored_j), 1.0)
        # 1e-9 relative: this is a bookkeeping identity in the scheme itself,
        # so the only error allowed is floating-point accumulation.
        assert abs(residual_j) / scale_j < 1e-9, f"energy not conserved at step {step_index}"

        temp_c = result.temp_c
