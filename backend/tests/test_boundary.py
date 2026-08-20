"""Surface exchange. The Uno check is against ACI 305.1-14's own worked example."""

import numpy as np
import pytest

from physics.equations import boundary


# ACI 305.1-14 worked example, quoted in the standard as 0.17 lb/ft2/h.
# 90 F surface, 100 F air, 56% RH, 18 mph wind. This is the check that catches
# a wrong Fahrenheit conversion - every other bug in Uno still yields a smooth curve.
def test_uno_matches_aci_worked_example() -> None:
    e = float(
        boundary.evaporation_rate_kg_m2_s(
            surface_temp_c=32.2222, air_temp_c=37.7778, rh_frac=0.56, wind_ms=8.0499
        )
    )
    assert e == pytest.approx(0.17 * 1.3562e-3, rel=0.02)
    assert e == pytest.approx(2.31e-4, rel=0.02)


# saturated air over cool concrete cannot evaporate. never negative.
def test_uno_clamps_at_zero() -> None:
    assert float(boundary.evaporation_rate_kg_m2_s(10.0, 40.0, 1.0, 0.0)) == 0.0


# still air lands on the 5.6 intercept, and the branch is continuous at 5 m/s
def test_h_convective_branches() -> None:
    assert float(boundary.h_convective(0.0)) == pytest.approx(5.6)
    low = float(boundary.h_convective(4.999999))
    high = float(boundary.h_convective(5.000001))
    # the published correlation genuinely steps at 5 m/s: 25.35 -> 26.67 W/m2K.
    # a ~5% jump is the correlation's own, not ours. it must stay small and upward.
    assert 0.0 < high - low < 1.5
    assert np.all(np.diff(boundary.h_convective(np.linspace(0.0, 20.0, 200))) > 0.0)


# clear sky is 6 C colder than air, overcast sky is air temperature. trap 6.
def test_sky_temperature_uses_percent_not_octas() -> None:
    assert float(boundary.sky_temperature_c(20.0, 0.0)) == pytest.approx(14.0)
    assert float(boundary.sky_temperature_c(20.0, 100.0)) == pytest.approx(20.0)
    assert float(boundary.sky_temperature_c(20.0, 50.0)) == pytest.approx(17.0)


# radiative coefficient for ordinary conditions sits in the literature 4-7 W/m2K band
def test_h_radiative_magnitude() -> None:
    h = float(boundary.h_radiative(30.0, 14.0))
    assert 4.0 < h < 7.0
    # kelvin, not celsius: at 0 C surface and 0 C sky it must not vanish
    assert float(boundary.h_radiative(0.0, 0.0)) == pytest.approx(
        0.90 * 5.67e-8 * 4.0 * 273.15**3, rel=1e-9
    )


# formwork always lowers the effective coefficient, and an insulating blanket dominates
def test_h_effective_series_resistance() -> None:
    film = 15.0
    assert float(boundary.h_effective(film, 0.0, 0.0)) == pytest.approx(film)
    assert float(boundary.h_effective(film, 0.0, 0.15)) == pytest.approx(1.0 / (1.0 / 15.0 + 0.15))
    assert float(boundary.h_effective(film, 0.0, 1.0)) < 1.0


# clear sky passes everything, overcast keeps a quarter. trap 6.
def test_cloud_attenuation_uses_percent() -> None:
    assert float(boundary.cloud_attenuation(800.0, 0.0)) == pytest.approx(800.0)
    assert float(boundary.cloud_attenuation(800.0, 100.0)) == pytest.approx(200.0)
    # 8 octas entered as 8 would be a near-clear sky - the bug this test exists for
    assert float(boundary.cloud_attenuation(800.0, 8.0)) > 790.0


# fresh concrete absorbs about half the incident irradiance
def test_absorbed_solar() -> None:
    assert float(boundary.absorbed_solar_w_m2(1000.0, 0.0)) == pytest.approx(550.0)
