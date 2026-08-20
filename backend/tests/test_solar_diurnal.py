"""Solar geometry and Parton-Logan reconstruction."""

import numpy as np
import pytest

from physics.equations import diurnal, solar

PHOENIX_LAT = 33.45
MID_JULY = 196


# equinox declination is ~0, solstices are +-23.45
def test_declination_landmarks() -> None:
    assert float(solar.declination_deg(81)) == pytest.approx(0.0, abs=0.6)   # 22 Mar
    assert float(solar.declination_deg(172)) == pytest.approx(23.45, abs=0.2)  # 21 Jun
    assert float(solar.declination_deg(355)) == pytest.approx(-23.45, abs=0.2)  # 21 Dec


# phoenix mid-july is a long day but not an absurd one
def test_phoenix_midsummer_daylength() -> None:
    decl = solar.declination_deg(MID_JULY)
    day_len = float(solar.daylength_h(solar.sunset_hour_angle_deg(PHOENIX_LAT, decl)))
    assert 13.5 <= day_len <= 14.5
    assert float(solar.sunrise_h(day_len)) == pytest.approx(12.0 - day_len / 2.0)


# equator gets 12 hours all year
def test_equator_is_always_twelve_hours() -> None:
    for n in (1, 100, 200, 300):
        decl = solar.declination_deg(n)
        assert float(solar.daylength_h(solar.sunset_hour_angle_deg(0.0, decl))) == pytest.approx(
            12.0, abs=1e-9
        )


# the half-sine must reproduce the daylight-hours mean it was given
def test_hourly_ghi_preserves_daylight_mean() -> None:
    day_len, sunrise, mean_ghi = 14.0, 5.0, 300.0
    t = np.linspace(sunrise, sunrise + day_len, 20001)
    ghi = solar.hourly_ghi_w_m2(mean_ghi, t, sunrise, day_len)
    assert np.trapezoid(ghi, t) / day_len == pytest.approx(mean_ghi, rel=1e-4)
    # dark outside daylight, never negative
    assert float(solar.hourly_ghi_w_m2(mean_ghi, 2.0, sunrise, day_len)) == 0.0
    assert float(solar.hourly_ghi_w_m2(mean_ghi, 23.0, sunrise, day_len)) == 0.0
    assert np.all(ghi >= 0.0)


# min and max land near target, mean lands exactly. that third constraint is the point.
def test_diurnal_matches_all_three_statistics() -> None:
    t_min_c, t_mean_c, t_max_c = 24.0, 33.0, 43.0
    series_c = diurnal.hourly_air_temp_c(t_min_c, t_mean_c, t_max_c, PHOENIX_LAT, MID_JULY)
    assert series_c.shape == (24,)
    assert float(series_c.mean()) == pytest.approx(t_mean_c, abs=0.01)
    assert float(series_c.max() - series_c.min()) == pytest.approx(t_max_c - t_min_c, abs=0.01)
    assert float(series_c.min()) == pytest.approx(t_min_c, abs=2.0)
    assert float(series_c.max()) == pytest.approx(t_max_c, abs=2.0)


# hottest in the afternoon, coldest around dawn. not the other way round.
def test_diurnal_peaks_in_the_afternoon() -> None:
    series_c = diurnal.hourly_air_temp_c(24.0, 33.0, 43.0, PHOENIX_LAT, MID_JULY)
    assert 13 <= int(series_c.argmax()) <= 18
    assert int(series_c.argmin()) <= 7


# multi-day series is the same day repeated, aligned to the requested start hour
def test_series_tiles_by_day() -> None:
    s = diurnal.air_temp_series_c(24.0, 33.0, 43.0, PHOENIX_LAT, MID_JULY, hours=72, start_hour=6.0)
    assert s.shape == (72,)
    assert np.allclose(s[:24], s[24:48])
    assert np.allclose(s[:24], s[48:])
