"""Clear-sky geometry: declination, daylength, hourly irradiance shape."""

import numpy as np

from physics import FloatArray, Floats


# day of year in, solar declination degrees out. cooper 1969.
def declination_deg(day_of_year: Floats) -> FloatArray:
    n = np.asarray(day_of_year, dtype=np.float64)
    return np.asarray(23.45 * np.sin(np.radians(360.0 * (284.0 + n) / 365.0)), dtype=np.float64)


# latitude and declination in, sunset hour angle degrees out.
def sunset_hour_angle_deg(lat_deg: Floats, decl_deg: Floats) -> FloatArray:
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    decl = np.radians(np.asarray(decl_deg, dtype=np.float64))
    # clip covers polar day and polar night, where the arccos argument leaves [-1, 1]
    return np.asarray(
        np.degrees(np.arccos(np.clip(-np.tan(lat) * np.tan(decl), -1.0, 1.0))), dtype=np.float64
    )


# hour angle in, daylength hours out. earth turns 15 degrees an hour.
def daylength_h(omega_s_deg: Floats) -> FloatArray:
    return np.asarray(2.0 / 15.0 * np.asarray(omega_s_deg, dtype=np.float64), dtype=np.float64)


# daylength in, local solar sunrise hour out. noon is the midpoint by definition.
def sunrise_h(daylength: Floats) -> FloatArray:
    return np.asarray(12.0 - np.asarray(daylength, dtype=np.float64) / 2.0, dtype=np.float64)


# daylight-mean ghi in, hourly W/m2 out. half-sine preserves that mean.
#
# ghi_daily_w_m2 is the mean over the DAYLIGHT hours, not over all 24. the half-sine
# integrates to peak*D*2/pi, so peak = (pi/2)*mean reproduces the daylight mean exactly.
def hourly_ghi_w_m2(
    ghi_daily_w_m2: Floats, hour: Floats, sunrise: Floats, daylength: Floats
) -> FloatArray:
    peak = (np.pi / 2.0) * np.asarray(ghi_daily_w_m2, dtype=np.float64)
    x = (np.asarray(hour, dtype=np.float64) - np.asarray(sunrise)) / np.asarray(daylength)
    return np.asarray(
        np.where((x >= 0.0) & (x <= 1.0), peak * np.sin(np.pi * np.clip(x, 0.0, 1.0)), 0.0),
        dtype=np.float64,
    )
