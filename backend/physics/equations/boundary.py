"""Surface exchange: convection, radiation, formwork, solar gain, evaporative loss."""

import numpy as np

from physics import FloatArray, Floats
from physics.constants import EMISSIVITY, SOLAR_ABSORPTIVITY, STEFAN_BOLTZMANN

# thermal resistance of the formwork layer, m2K/W. steel is bare metal - no resistance.
FORMWORK_R = {
    "bare": 0.0,
    "plywood_18mm": 0.15,
    "steel": 0.0,
    "insulating_blanket": 1.0,
}


# wind in m/s, convective coefficient W/m2K out.
def h_convective(wind_ms: Floats) -> FloatArray:
    v = np.asarray(wind_ms, dtype=np.float64)
    return np.asarray(np.where(v < 5.0, 5.6 + 3.95 * v, 7.6 * np.maximum(v, 1e-9) ** 0.78),
                      dtype=np.float64)


# cloud cover is PERCENT 0-100 despite the api field name saying octas. trap 6.
def sky_temperature_c(
    air_temp_c: Floats, cloud_pct: Floats, clear_offset_c: float = 6.0
) -> FloatArray:
    t_air_c = np.asarray(air_temp_c, dtype=np.float64)
    return np.asarray(
        t_air_c - clear_offset_c * (1.0 - np.asarray(cloud_pct, dtype=np.float64) / 100.0),
        dtype=np.float64,
    )


# linearised radiation coefficient W/m2K. kelvin only inside. trap 4.
def h_radiative(
    surface_temp_c: Floats, sky_temp_c: Floats, emissivity: float = EMISSIVITY
) -> FloatArray:
    ts_k = np.asarray(surface_temp_c, dtype=np.float64) + 273.15
    tsky_k = np.asarray(sky_temp_c, dtype=np.float64) + 273.15
    return np.asarray(
        emissivity * STEFAN_BOLTZMANN * (ts_k**2 + tsky_k**2) * (ts_k + tsky_k),
        dtype=np.float64,
    )


# formwork resistance in series with the surface film.
def h_effective(h_conv: Floats, h_rad: Floats, formwork_r_m2k_w: float) -> FloatArray:
    film = np.asarray(h_conv, dtype=np.float64) + np.asarray(h_rad, dtype=np.float64)
    return np.asarray(1.0 / (1.0 / np.maximum(film, 1e-9) + formwork_r_m2k_w), dtype=np.float64)


# kasten-czeplak cloud attenuation. cloud_pct is PERCENT. trap 6.
def cloud_attenuation(ghi_clear_w_m2: Floats, cloud_pct: Floats) -> FloatArray:
    c = np.asarray(cloud_pct, dtype=np.float64) / 100.0
    return np.asarray(
        np.asarray(ghi_clear_w_m2, dtype=np.float64) * (1.0 - 0.75 * np.clip(c, 0.0, 1.0) ** 3.4),
        dtype=np.float64,
    )


# absorbed solar flux into the surface, W/m2.
def absorbed_solar_w_m2(
    ghi_clear_w_m2: Floats, cloud_pct: Floats, absorptivity: float = SOLAR_ABSORPTIVITY
) -> FloatArray:
    return np.asarray(absorptivity * cloud_attenuation(ghi_clear_w_m2, cloud_pct), dtype=np.float64)


# ACI 305.1-14 Uno. celsius + m/s in, kg/m2/s out. imperial NEVER escapes. trap 5.
def evaporation_rate_kg_m2_s(
    surface_temp_c: Floats, air_temp_c: Floats, rh_frac: Floats, wind_ms: Floats
) -> FloatArray:
    tc_f = np.asarray(surface_temp_c, dtype=np.float64) * 9.0 / 5.0 + 32.0
    ta_f = np.asarray(air_temp_c, dtype=np.float64) * 9.0 / 5.0 + 32.0
    v_mph = np.asarray(wind_ms, dtype=np.float64) * 2.23694
    rh = np.asarray(rh_frac, dtype=np.float64)
    e_lb_ft2_h = (
        (np.maximum(tc_f, 0.0) ** 2.5 - rh * np.maximum(ta_f, 0.0) ** 2.5)
        * (1.0 + 0.4 * v_mph)
        * 1e-6
    )
    return np.asarray(np.maximum(e_lb_ft2_h, 0.0) * 1.3562e-3, dtype=np.float64)
