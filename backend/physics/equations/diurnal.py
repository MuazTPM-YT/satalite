"""Parton-Logan diurnal air temperature from daily min, mean and max."""

import numpy as np

from physics import FloatArray
from physics.equations.solar import (
    daylength_h,
    declination_deg,
    sunrise_h,
    sunset_hour_angle_deg,
)

# parton & logan 1981 fitted lags: daytime sine offset and nighttime decay constant.
DAY_LAG_H = 1.86
NIGHT_DECAY = 2.20


# daily min/mean/max in, 24 hourly celsius out. mean is matched exactly.
def hourly_air_temp_c(
    t_min_c: float,
    t_mean_c: float,
    t_max_c: float,
    lat_deg: float,
    day_of_year: int,
    samples_per_day: int = 24,
) -> FloatArray:
    day_len = float(daylength_h(sunset_hour_angle_deg(lat_deg, declination_deg(day_of_year))))
    sunrise = float(sunrise_h(day_len))
    sunset = sunrise + day_len

    step_h = 24.0 / samples_per_day
    hour = (np.arange(samples_per_day, dtype=np.float64) + 0.5) * step_h

    amp_c = t_max_c - t_min_c
    day_c = t_min_c + amp_c * np.sin(np.pi * (hour - sunrise) / (day_len + 2.0 * DAY_LAG_H))
    sunset_c = t_min_c + amp_c * np.sin(np.pi * day_len / (day_len + 2.0 * DAY_LAG_H))

    hours_since_sunset = np.where(hour > sunset, hour - sunset, hour + 24.0 - sunset)
    night_c = t_min_c + (sunset_c - t_min_c) * np.exp(
        -NIGHT_DECAY * hours_since_sunset / (24.0 - day_len)
    )

    raw_c = np.where((hour >= sunrise) & (hour <= sunset), day_c, night_c)

    # we have a third constraint most reconstructions lack: the true 24h mean.
    # affine rescale keeps the diurnal range exact and pins the mean exactly;
    # min and max then shift together by however much the raw mean was off.
    span = float(raw_c.max() - raw_c.min())
    gain = amp_c / span if span > 0.0 else 1.0
    offset = t_mean_c - gain * float(raw_c.mean())
    return np.asarray(gain * raw_c + offset, dtype=np.float64)


# tile one day's shape across a multi-day run. hours since placement in, celsius out.
def air_temp_series_c(
    t_min_c: float,
    t_mean_c: float,
    t_max_c: float,
    lat_deg: float,
    day_of_year: int,
    hours: int,
    start_hour: float = 0.0,
) -> FloatArray:
    one_day_c = hourly_air_temp_c(t_min_c, t_mean_c, t_max_c, lat_deg, day_of_year)
    idx = (np.arange(hours) + int(round(start_hour))) % 24
    return np.asarray(one_day_c[idx], dtype=np.float64)
