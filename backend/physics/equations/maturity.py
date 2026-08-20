"""ASTM C1074 maturity: Arrhenius equivalent age and Nurse-Saul degree-hours."""

import numpy as np

from physics import FloatArray, Floats
from physics.constants import (
    EA_BASE,
    EA_BREAKPOINT_C,
    EA_COLD_SLOPE,
    GAS_CONSTANT,
    T_DATUM_DEFAULT_C,
    T_REF_DEFAULT_C,
)


# celsius in, activation energy J/mol out. astm c1074 two-branch form.
def activation_energy_j_mol(temps_c: Floats) -> FloatArray:
    t_c = np.asarray(temps_c, dtype=np.float64)
    cold = np.asarray(EA_COLD_SLOPE * (EA_BREAKPOINT_C - t_c), dtype=np.float64)
    np.maximum(cold, 0.0, out=cold)  # same two branches, one pass, no boolean temporary
    cold += EA_BASE
    return cold


# arrhenius rate multiplier. celsius in, dimensionless out. kelvin only inside.
def rate_multiplier(temps_c: Floats, t_ref_c: float = T_REF_DEFAULT_C) -> FloatArray:
    t_c = np.asarray(temps_c, dtype=np.float64)
    t_k = t_c + 273.15
    exponent = activation_energy_j_mol(t_c)
    exponent /= -GAS_CONSTANT
    exponent *= 1.0 / t_k - 1.0 / (t_ref_c + 273.15)
    return np.asarray(np.exp(exponent, out=exponent), dtype=np.float64)


# cumulative equivalent age at the reference temperature. hours.
def equivalent_age_h(
    temps_c: FloatArray, dt_h: float, t_ref_c: float = T_REF_DEFAULT_C
) -> FloatArray:
    return np.cumsum(rate_multiplier(temps_c, t_ref_c) * dt_h)


# nurse-saul degree-hours. secondary output, report only.
def nurse_saul_ch(
    temps_c: FloatArray, dt_h: float, t_datum_c: float = T_DATUM_DEFAULT_C
) -> FloatArray:
    t_c = np.asarray(temps_c, dtype=np.float64)
    return np.cumsum(np.maximum(t_c - t_datum_c, 0.0) * dt_h)
