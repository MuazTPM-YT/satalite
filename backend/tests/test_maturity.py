"""ASTM C1074 maturity checks. Golden test 3 lives in test_golden.py."""

import numpy as np
import pytest

from physics.constants import EA_BASE, EA_COLD_SLOPE
from physics.equations import maturity


# at the reference temperature the exponent is exactly zero, so the weight is exactly one
def test_rate_multiplier_is_one_at_reference() -> None:
    for t_ref_c in (10.0, 20.0, 23.0, 30.0):
        assert maturity.rate_multiplier(t_ref_c, t_ref_c) == pytest.approx(1.0, rel=1e-15)


# hotter ages faster, colder slower. no exceptions.
def test_rate_multiplier_monotonic() -> None:
    temps_c = np.linspace(-5.0, 60.0, 200)
    r = maturity.rate_multiplier(temps_c, 20.0)
    assert np.all(np.diff(r) > 0.0)
    assert maturity.rate_multiplier(5.0, 20.0) < 1.0 < maturity.rate_multiplier(35.0, 20.0)


# astm switches slope at 20 C, and that breakpoint is not the reference temperature
def test_activation_energy_two_branch() -> None:
    assert maturity.activation_energy_j_mol(25.0) == pytest.approx(EA_BASE)
    assert maturity.activation_energy_j_mol(20.0) == pytest.approx(EA_BASE)
    assert maturity.activation_energy_j_mol(10.0) == pytest.approx(EA_BASE + 10.0 * EA_COLD_SLOPE)
    # changing T_ref must not move the breakpoint
    assert maturity.rate_multiplier(10.0, 30.0) > 0.0
    assert maturity.activation_energy_j_mol(10.0) == pytest.approx(EA_BASE + 10.0 * EA_COLD_SLOPE)


# cumulative outputs, one entry per input sample
def test_shapes_are_cumulative() -> None:
    temps_c = np.full(24, 20.0)
    te = maturity.equivalent_age_h(temps_c, 1.0)
    ns = maturity.nurse_saul_ch(temps_c, 1.0)
    assert te.shape == ns.shape == (24,)
    assert np.all(np.diff(te) > 0.0)


# below the datum, concrete accrues no nurse-saul maturity at all
def test_nurse_saul_clamps_below_datum() -> None:
    assert maturity.nurse_saul_ch(np.full(5, -20.0), 1.0)[-1] == 0.0
