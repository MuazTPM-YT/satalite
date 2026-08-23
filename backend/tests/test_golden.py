"""Five golden physics tests. Every one is a known-answer check against a result
that does not depend on our implementation: a closed-form limit, an identity, a
conservation law, or a convergence property.

Do not delete them, do not loosen the tolerances to make them pass, and do not "fix"
the expected values - if the solver disagrees with these, the solver is wrong.

Comments here are deliberately fuller than the rest of the codebase, because these
encode the physics and a misreading here produces confidently wrong output everywhere
downstream.
"""

import numpy as np
import pytest

from physics.equations import conduction, hydration, maturity
from physics.geometry import rasterize
from physics.solver import solve, uniform_ambient
from physics.types import Ambient, Element, Mix

# A representative structural mix. 400 kg/m3 cement is a normal mid-range dose.
CEMENT_KG_M3 = 400.0
HU_J_PER_G = 450.0     # total heat of hydration per gram of cement
HU_J_PER_KG = HU_J_PER_G * 1000.0
ALPHA_U = 0.7          # ultimate degree of hydration - cement never fully reacts
TAU_H = 15.1           # hydration time parameter, from the Schindler-Folliard regression
BETA = 0.9
RHO_KG_M3 = 2400.0     # concrete density
CP_J_KG_K = 1000.0     # concrete specific heat
K_W_M_K = 2.2          # concrete conductivity

GOLDEN_400 = Mix(
    cement_kg_m3=CEMENT_KG_M3,
    h_u_j_per_kg=HU_J_PER_KG,
    alpha_u=ALPHA_U,
    tau_h=TAU_H,
    beta=BETA,
    rho_kg_m3=RHO_KG_M3,
    cp_j_kg_k=CP_J_KG_K,
    k_w_m_k=K_W_M_K,
)

# Same thermal properties, zero binder: pure heat equation, no source term at all.
GOLDEN_INERT = Mix(
    cement_kg_m3=0.0,
    h_u_j_per_kg=0.0,
    alpha_u=ALPHA_U,
    tau_h=TAU_H,
    beta=BETA,
    rho_kg_m3=RHO_KG_M3,
    cp_j_kg_k=CP_J_KG_K,
    k_w_m_k=K_W_M_K,
)


# ---------------------------------------------------------------------------
# GOLDEN 1 - adiabatic temperature rise
# ---------------------------------------------------------------------------
def test_golden_1_adiabatic_temperature_rise() -> None:
    """With every loss switched off, all hydration heat stays in the concrete.

    The total rise is then pure energy bookkeeping, independent of the solver's
    grid, timestep, or boundary code:

        dT = H_u * C_c * alpha_u / (rho * c_p)

    Units: H_u [J/g] * 1000 [g/kg] * C_c [kg/m3] * alpha_u  ->  J/m3,
    divided by rho [kg/m3] * c_p [J/(kg*K)] -> J/(m3*K), leaving kelvin (== degC of rise).

        450 * 1000 * 400 * 0.7 / (2400 * 1000) = 52.5 C

    Independent sanity check: the field rule of thumb is a 12-14 C rise per 100 kg/m3
    of cement, so 400 kg/m3 should land in 48-56 C. 52.5 sits mid-band, which is why we
    trust the closed form rather than the solver here.

    THIS IS THE TEST THAT VALIDATES THE J/g -> J/kg CONVERSION. A result near 0.05 C
    means the 1000x was dropped; near 52000 C means it was applied twice.
    """
    expected_rise_c = (HU_J_PER_G * 1000.0 * CEMENT_KG_M3 * ALPHA_U) / (RHO_KG_M3 * CP_J_KG_K)
    assert 48.0 <= expected_rise_c <= 56.0  # guards the constants above, not the solver
    assert GOLDEN_400.adiabatic_rise_c == pytest.approx(expected_rise_c, rel=1e-9)

    # Integrate the source term directly, with no solver and no losses whatsoever.
    # This isolates the hydration chain and its units from every other module.
    #     dT/dt   = Q(t_e, T) / (rho * c_p)
    #     dt_e/dt = rate_multiplier(T)
    temp_c, t_e_h, dt_s = 20.0, 0.0, 60.0
    for _ in range(int(28 * 24 * 3600 / dt_s)):  # 28 days, long enough to effectively finish
        q_w_m3 = float(
            hydration.heat_rate_w_m3(t_e_h, temp_c, ALPHA_U, TAU_H, BETA, HU_J_PER_KG, CEMENT_KG_M3)
        )
        temp_c += q_w_m3 * dt_s / (RHO_KG_M3 * CP_J_KG_K)
        t_e_h += float(maturity.rate_multiplier(temp_c)) * dt_s / 3600.0

    # 1% low is expected, not error: alpha -> alpha_u only asymptotically, so 28 days
    # of equivalent age leaves a sliver of unreacted cement behind.
    assert temp_c - 20.0 == pytest.approx(expected_rise_c, rel=0.02)

    # And the full solver, run with every face sealed, must reach the same place.
    result = solve(
        # Sealed and uniform, so the mesh is irrelevant: a coarse grid keeps this
        # 28-day run cheap without changing the answer by a millikelvin.
        element=Element(shape="slab", dims_mm={"thickness": 300.0, "width": 100.0},
                        dx_m=0.05, placement_temp_c=20.0),
        mix=GOLDEN_400,
        ambient=uniform_ambient(20.0, hours=28 * 24),
        dt_s=60.0,
        hours=28 * 24,
        record_every_s=3600.0,
        adiabatic=True,
    )
    final_c = float(np.nanmean(result.temp_c_frames[-1]))
    assert final_c - 20.0 == pytest.approx(expected_rise_c, rel=0.02)

    # Adiabatic means uniform: with no losses there is nowhere for a gradient to come from.
    assert float(np.nanmax(result.temp_c_frames[-1]) - np.nanmin(result.temp_c_frames[-1])) < 0.01

    # And the REPORTED surface must be the cell it was reconstructed from. surface_temp_c
    # is not read off the frame - it is rebuilt from the cell centre through a film and an
    # external flux, both of which are zero on a sealed face. The frame check above cannot
    # see that reconstruction, which is how a fabricated 23.9 C core-surface differential
    # survived on a field uniform to twelve digits.
    assert np.allclose(result.surface_temp_c, result.core_temp_c, atol=1e-9)


# ---------------------------------------------------------------------------
# GOLDEN 2 - no hydration, pure decay
# ---------------------------------------------------------------------------
def test_golden_2_no_hydration_decays_monotonically() -> None:
    """Kill the heat source and the solver is just the heat equation.

    With a uniform initial temperature above a constant ambient and no source, the
    only physically admissible behaviour is a monotonic approach to ambient from
    above. Any overshoot, oscillation, or temperature rising anywhere in the field
    means the explicit update is unstable or a flux sign is inverted - and an
    unstable explicit scheme does not crash, it returns a smooth wrong answer.

    We deliberately do NOT pin the surface to ambient with a huge h to compare against
    the erf semi-infinite solution: a Dirichlet-like h drives the Biot number to
    thousands, which forces a stability-limited dt of microseconds. Robin boundaries
    at realistic h are what the product actually runs, so that is what we verify.
    """
    initial_temp_c, ambient_temp_c = 40.0, 10.0
    result = solve(
        element=Element(shape="wall", dims_mm={"thickness": 300.0, "height": 300.0},
                        dx_m=0.01, placement_temp_c=initial_temp_c, formwork="bare"),
        mix=GOLDEN_INERT,
        ambient=uniform_ambient(ambient_temp_c, hours=24.0, wind_ms=2.0),
        dt_s=10.0,
        hours=24.0,
        record_every_s=600.0,
        evaporative_cooling=False,  # latent cooling legitimately drives the surface
    )                               # below air temperature; that is not what this test is about

    frames = result.temp_c_frames
    # Every cell, every frame: cooling, never heating. 1e-9 absorbs float noise only.
    assert np.all(np.diff(frames, axis=0) <= 1e-9)
    # Nothing may end up hotter than it started, and nothing may undershoot ambient.
    assert float(np.nanmax(frames)) <= initial_temp_c + 1e-9
    assert float(np.nanmin(frames)) >= ambient_temp_c - 1e-9
    # 24 h is long enough for a 300 mm wall at h ~ 15 W/m2K to get close to ambient.
    assert float(np.nanmax(frames[-1])) < ambient_temp_c + 2.0
    # The surface leads the core down, never the other way round.
    assert np.all(result.surface_temp_c <= result.core_temp_c + 1e-9)


# ---------------------------------------------------------------------------
# GOLDEN 3 - maturity identities
# ---------------------------------------------------------------------------
def test_golden_3_maturity_identities_at_constant_temperature() -> None:
    """At constant temperature both maturity functions collapse to identities.

    Nurse-Saul is a plain integral of (T - T_datum) dt, so holding T constant for a
    duration t must return exactly (T - T_datum) * t. No approximation is involved,
    hence the exact comparison.

    Arrhenius equivalent age reweights real time by
        exp( -E/R * (1/T - 1/T_ref) )   [T in KELVIN]
    so at T = T_ref the exponent is exactly zero, the weight is exactly 1, and the
    equivalent age must equal the elapsed time exactly. If this drifts, the
    celsius-to-kelvin conversion is wrong - the single most common bug in maturity code.
    """
    dt_h, hours = 1.0, 24
    t_datum_c = -10.0  # ASTM C1074 Nurse-Saul datum

    held_temp_c = 30.0
    temps_c = np.full(hours, held_temp_c)
    expected_c_hours = (held_temp_c - t_datum_c) * hours * dt_h
    assert maturity.nurse_saul_ch(temps_c, dt_h, t_datum_c)[-1] == pytest.approx(
        expected_c_hours, rel=1e-12
    )

    # Arrhenius at exactly the reference temperature: equivalent age == real time.
    # Asserted for several T_ref values, because a module-level T_ref (trap 7) would
    # make this pass for one value and silently fail for the others.
    for t_ref_c in (10.0, 20.0, 23.0, 35.0):
        at_ref_c = np.full(hours, t_ref_c)
        assert maturity.equivalent_age_h(at_ref_c, dt_h, t_ref_c)[-1] == pytest.approx(
            hours * dt_h, rel=1e-12
        )

    # Direction check: hotter than reference ages the concrete faster, colder slower.
    hot = maturity.equivalent_age_h(np.full(hours, 35.0), dt_h, 20.0)[-1]
    cold = maturity.equivalent_age_h(np.full(hours, 5.0), dt_h, 20.0)[-1]
    assert cold < hours * dt_h < hot


# ---------------------------------------------------------------------------
# GOLDEN 4 - first law, every timestep
# ---------------------------------------------------------------------------
def test_golden_4_energy_balance_every_timestep() -> None:
    """First law, checked every single timestep, not just at the end.

        heat generated == heat stored + heat lost through all faces

    An end-of-run check can hide errors that cancel; a per-step check cannot. This is
    the test that catches a mis-scaled source term, a boundary flux applied over the
    wrong face area, or a timestep used twice.

    In the cell-centred formulation this is a bookkeeping identity in the scheme
    itself - every internal conduction face appears twice with opposite sign and
    cancels exactly - so the only error permitted is floating-point accumulation.
    """
    section = rasterize("rect_column", {"width": 600.0, "height": 600.0}, dx_m=0.02)
    n_solid = conduction.neighbour_counts(section.mask)

    # Every exterior face gets the same coefficient, so the balance has to close
    # across formed sides, an open top, and the four corner cells with two faces each -
    # a corner carries two faces' worth, which is exactly what a per-face area error
    # would get wrong.
    exterior_faces = (section.face_tags != 0).sum(axis=0).astype(np.float64)
    h_sum = exterior_faces * 10.0
    q_sum = exterior_faces * 25.0
    assert h_sum.max() == 20.0  # the corner cells really do have two open faces

    dt_s = min(60.0, conduction.max_stable_dt_s(
        section.mask, h_sum, section.dx_m, GOLDEN_400.alpha_m2_s, GOLDEN_400.k_w_m_k
    ))
    temp_c = np.where(section.mask, 20.0, np.nan).astype(np.float64)
    ambient_temp_c = 15.0

    for step_index in range(200):
        t_e_h = np.full(temp_c.shape, step_index * dt_s / 3600.0)
        source_w_m3 = np.where(
            section.mask,
            hydration.heat_rate_w_m3(
                t_e_h, np.nan_to_num(temp_c, nan=20.0), GOLDEN_400.alpha_u, GOLDEN_400.tau_h,
                GOLDEN_400.beta, GOLDEN_400.h_u_j_per_kg, GOLDEN_400.cement_kg_m3,
            ),
            0.0,
        )
        result = conduction.step(
            temp_c=temp_c,
            mask=section.mask,
            n_solid=n_solid,
            h_sum_w_m2_k=h_sum,
            q_sum_w_m2=q_sum,
            air_temp_c=ambient_temp_c,
            source_w_m3=source_w_m3,
            dx_m=section.dx_m,
            dt_s=dt_s,
            rho_kg_m3=GOLDEN_400.rho_kg_m3,
            cp_j_kg_k=GOLDEN_400.cp_j_kg_k,
            k_w_m_k=GOLDEN_400.k_w_m_k,
        )

        residual_j = result.heat_generated_j - (result.heat_stored_j + result.heat_lost_j)
        scale_j = max(abs(result.heat_generated_j), abs(result.heat_stored_j), 1.0)
        assert abs(residual_j) / scale_j < 1e-9, f"energy not conserved at step {step_index}"

        temp_c = result.temp_c


# ---------------------------------------------------------------------------
# GOLDEN 5 - grid convergence
# ---------------------------------------------------------------------------
def test_golden_5_grid_convergence() -> None:
    """Halving dx must not move the answer. If it does, dx is a free parameter.

    A first-order-in-space scheme still converges; the point of this test is that the
    discretisation error at the shipping resolution (dx = 10 mm) is already small
    compared to anything a site engineer would act on. If the two runs disagree by
    more than 0.1 C, the reported peak core temperature is a property of our mesh
    rather than of the concrete.

    Both runs use the same dt-to-dx ratio scaling that stability demands: the explicit
    limit goes as dx**2, so halving dx quarters the timestep.
    """
    element_kwargs = {
        "shape": "slab",
        "dims_mm": {"thickness": 200.0, "width": 100.0},
        "placement_temp_c": 25.0,
    }
    ambient = uniform_ambient(20.0, hours=24.0, wind_ms=3.0)

    coarse = solve(
        element=Element(dx_m=0.010, **element_kwargs),  # type: ignore[arg-type]
        mix=GOLDEN_400, ambient=ambient, dt_s=10.0, hours=24.0, record_every_s=1800.0,
    )
    fine = solve(
        element=Element(dx_m=0.005, **element_kwargs),  # type: ignore[arg-type]
        mix=GOLDEN_400, ambient=ambient, dt_s=2.5, hours=24.0, record_every_s=1800.0,
    )

    assert abs(coarse.peak_core_temp_c - fine.peak_core_temp_c) < 0.1
    assert abs(coarse.peak_core_time_h - fine.peak_core_time_h) <= 0.5


# ---------------------------------------------------------------------------
# Trap 2 guard - an unstable timestep must raise, not return smooth garbage.
# ---------------------------------------------------------------------------
def test_unstable_timestep_raises_with_the_limit_named() -> None:
    ambient = uniform_ambient(20.0, hours=1.0)
    with pytest.raises(conduction.TimestepTooLargeError, match="stability limit"):
        solve(
            element=Element(shape="slab", dims_mm={"thickness": 300.0, "width": 100.0}),
            mix=GOLDEN_400, ambient=ambient, dt_s=60.0, hours=1.0,
        )


# The spec's headline number: dx = 10 mm, alpha = 9.2e-7 m2/s gives dt_max ~ 27 s.
def test_stability_limit_matches_the_hand_calculation() -> None:
    section = rasterize("slab", {"thickness": 300.0, "width": 100.0}, dx_m=0.01)
    interior_only = np.zeros(section.mask.shape, dtype=np.float64)
    limit_s = conduction.max_stable_dt_s(
        section.mask, interior_only, 0.01, GOLDEN_400.alpha_m2_s, GOLDEN_400.k_w_m_k
    )
    # Interior cells have 4 solid neighbours, so Fo <= 1/4 and dt <= dx**2 / (4 alpha).
    assert GOLDEN_400.alpha_m2_s == pytest.approx(9.17e-7, rel=1e-2)
    assert limit_s == pytest.approx(0.01**2 / (4.0 * GOLDEN_400.alpha_m2_s), rel=1e-12)
    assert 26.0 < limit_s < 28.0
    # We ship dt = 10 s, comfortably under 0.4x the limit.
    assert 10.0 < 0.4 * limit_s


# Real weather, real geometry, real losses. Not a golden test - a smell test.
def test_realistic_run_is_physically_sane() -> None:
    from physics.equations import diurnal, solar

    hours = 72
    hour_of_day = (np.arange(hours) + 0.5) % 24.0
    omega = solar.sunset_hour_angle_deg(33.45, solar.declination_deg(196))
    day_len = float(solar.daylength_h(omega))
    ambient = Ambient(
        hours=np.arange(hours, dtype=np.float64),
        air_temp_c=diurnal.air_temp_series_c(24.0, 33.0, 43.0, 33.45, 196, hours),
        rh_frac=np.full(hours, 0.25),
        wind_ms=np.full(hours, 3.0),
        cloud_pct=np.full(hours, 10.0),
        ghi_w_m2=solar.hourly_ghi_w_m2(600.0, hour_of_day, solar.sunrise_h(day_len), day_len),
    )
    result = solve(
        element=Element(shape="slab", dims_mm={"thickness": 300.0, "width": 100.0},
                        placement_temp_c=30.0, formwork="plywood_18mm"),
        mix=GOLDEN_400, ambient=ambient, dt_s=10.0, hours=72.0,
    )
    # A 300 mm slab in Phoenix in July gets hot but cannot approach the adiabatic limit.
    assert 40.0 < result.peak_core_temp_c < 30.0 + GOLDEN_400.adiabatic_rise_c
    # Peak core heat arrives within the first day and a half.
    assert 6.0 < result.peak_core_time_h < 36.0
    # A 300 mm section cannot build a huge gradient, but it must build some.
    assert 0.5 < result.max_core_surface_diff_c < 25.0
    # Maturity only ever accumulates.
    assert np.all(np.diff(np.nanmax(result.t_e_h_frames, axis=(1, 2))) > 0.0)
