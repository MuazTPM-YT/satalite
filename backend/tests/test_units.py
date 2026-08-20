"""Every conversion must invert. Swept over a wide range, not spot-checked."""

import numpy as np
import pytest

from physics import units

SWEEP = np.linspace(-80.0, 120.0, 401)

ROUND_TRIPS = [
    (units.c_to_k, units.k_to_c),
    (units.c_to_f, units.f_to_c),
    (units.ms_to_mph, units.mph_to_ms),
    (units.lb_ft2_h_to_kg_m2_s, units.kg_m2_s_to_lb_ft2_h),
    (units.j_per_g_to_j_per_kg, units.j_per_kg_to_j_per_g),
]


# forward then back must land where it started
@pytest.mark.parametrize(("fwd", "back"), ROUND_TRIPS, ids=lambda f: getattr(f, "__name__", ""))
def test_round_trip(fwd, back) -> None:  # type: ignore[no-untyped-def]
    assert np.allclose(back(fwd(SWEEP)), SWEEP, rtol=1e-12, atol=1e-12)
    assert np.allclose(fwd(back(SWEEP)), SWEEP, rtol=1e-12, atol=1e-12)


# known anchors. a round trip alone would pass even if both directions were wrong.
def test_known_anchors() -> None:
    assert units.c_to_k(0.0) == pytest.approx(273.15)
    assert units.c_to_f(100.0) == pytest.approx(212.0)
    assert units.f_to_c(32.0) == pytest.approx(0.0)
    assert units.ms_to_mph(1.0) == pytest.approx(2.23694)
    assert units.j_per_g_to_j_per_kg(450.0) == pytest.approx(450_000.0)
    # ACI 305 worked example: 0.17 lb/ft2/h is the "take action" threshold.
    assert units.lb_ft2_h_to_kg_m2_s(0.17) == pytest.approx(2.3055e-4, rel=1e-3)
