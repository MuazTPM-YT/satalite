"""Conversion primitives only. No domain logic lives here, ever."""

import numpy as np

from physics import FloatArray, Floats


# celsius to kelvin.
def c_to_k(temp_c: Floats) -> FloatArray:
    return np.asarray(temp_c, dtype=np.float64) + 273.15


# kelvin to celsius.
def k_to_c(temp_k: Floats) -> FloatArray:
    return np.asarray(temp_k, dtype=np.float64) - 273.15


# celsius to fahrenheit.
def c_to_f(temp_c: Floats) -> FloatArray:
    return np.asarray(temp_c, dtype=np.float64) * 9.0 / 5.0 + 32.0


# fahrenheit to celsius.
def f_to_c(temp_f: Floats) -> FloatArray:
    return (np.asarray(temp_f, dtype=np.float64) - 32.0) * 5.0 / 9.0


# metres per second to miles per hour.
def ms_to_mph(speed_ms: Floats) -> FloatArray:
    return np.asarray(speed_ms, dtype=np.float64) * 2.23694


# miles per hour to metres per second.
def mph_to_ms(speed_mph: Floats) -> FloatArray:
    return np.asarray(speed_mph, dtype=np.float64) / 2.23694


# imperial evaporation rate to SI. only aci 305 uno needs this.
def lb_ft2_h_to_kg_m2_s(rate_lb_ft2_h: Floats) -> FloatArray:
    return np.asarray(rate_lb_ft2_h, dtype=np.float64) * 1.3562e-3


# SI evaporation rate back to imperial. inverse of the above.
def kg_m2_s_to_lb_ft2_h(rate_kg_m2_s: Floats) -> FloatArray:
    return np.asarray(rate_kg_m2_s, dtype=np.float64) / 1.3562e-3


# joules per gram to joules per kilogram. trap 1 lives here.
def j_per_g_to_j_per_kg(heat_j_per_g: Floats) -> FloatArray:
    return np.asarray(heat_j_per_g, dtype=np.float64) * 1000.0


# joules per kilogram back to joules per gram.
def j_per_kg_to_j_per_g(heat_j_per_kg: Floats) -> FloatArray:
    return np.asarray(heat_j_per_kg, dtype=np.float64) / 1000.0
