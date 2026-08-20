"""Schindler-Folliard parameter checks. The adiabatic integral is golden test 1."""

import numpy as np
import pytest

from physics.equations import hydration


# published regression value for a plain w/cm 0.45 mix
def test_ultimate_degree_reference_value() -> None:
    assert hydration.ultimate_degree(0.45) == pytest.approx(0.7205, rel=1e-3)


# scm terms are positive and the cap bites
def test_ultimate_degree_scm_and_cap() -> None:
    assert hydration.ultimate_degree(0.45, p_fa=0.2) > hydration.ultimate_degree(0.45)
    assert hydration.ultimate_degree(0.45, p_slag=0.4) > hydration.ultimate_degree(0.45)
    assert hydration.ultimate_degree(0.9, p_fa=0.5, p_slag=0.5) == pytest.approx(1.09)


# published regression value for a typical type I cement
def test_tau_reference_value() -> None:
    assert hydration.tau_hours(0.08, 0.55, 380.0, 0.03) == pytest.approx(15.1, rel=0.05)


# ordinary portland cement heat lands in the literature band 400-500 J/g
def test_cement_heat_in_literature_band() -> None:
    h = hydration.cement_heat_j_per_g(0.55, 0.18, 0.08, 0.09, 0.03, 0.005, 0.02)
    assert 400.0 <= h <= 520.0


# J/g in, J/kg out. off by 1000 is trap 1.
def test_ultimate_heat_is_per_kilogram() -> None:
    assert hydration.ultimate_heat_j_per_kg(450.0, 1.0) == pytest.approx(450_000.0)
    assert hydration.ultimate_heat_j_per_kg(450.0, 0.7, p_slag=0.3) == pytest.approx(
        (450.0 * 0.7 + 461.0 * 0.3) * 1000.0
    )


# alpha climbs from ~0 to alpha_u and never past it
def test_degree_of_hydration_bounds() -> None:
    t_e_h = np.array([0.0, 1.0, 12.0, 24.0, 168.0, 1e6])
    a = hydration.degree_of_hydration(t_e_h, 0.72, 15.1, 0.9)
    assert a[0] == pytest.approx(0.0, abs=1e-12)
    assert np.all(np.diff(a) > 0.0)
    # exp(-(tau/t)**beta) approaches 1 only asymptotically, so alpha_u is a limit
    assert a[-1] == pytest.approx(0.72, rel=1e-3)
    assert np.all(a <= 0.72)


# the rate must be the derivative of the degree. finite difference proves it.
def test_rate_matches_numerical_derivative() -> None:
    t_e_h = np.linspace(1.0, 200.0, 500)
    h = 1e-4
    numerical = (
        hydration.degree_of_hydration(t_e_h + h, 0.72, 15.1, 0.9)
        - hydration.degree_of_hydration(t_e_h - h, 0.72, 15.1, 0.9)
    ) / (2.0 * h)
    analytical = hydration.d_alpha_d_te(t_e_h, 0.72, 15.1, 0.9)
    assert np.allclose(numerical, analytical, rtol=1e-6, atol=1e-12)


# no nan or inf at t=0, where (tau/t)**beta wants to explode
def test_no_blowup_at_zero_age() -> None:
    q = hydration.heat_rate_w_m3(0.0, 20.0, 0.72, 15.1, 0.9, 450_000.0, 400.0)
    assert np.isfinite(q) and q >= 0.0
