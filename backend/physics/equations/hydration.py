"""Schindler-Folliard 2005 hydration. Heat source term for the solver."""

import numpy as np

from physics import FloatArray, Floats
from physics.constants import (
    ALPHA_U_A,
    ALPHA_U_B,
    ALPHA_U_CAP,
    ALPHA_U_FA,
    ALPHA_U_SLAG,
    BETA_DEFAULT,
    T_REF_DEFAULT_C,
)
from physics.equations.maturity import rate_multiplier


# mix in, ultimate degree of hydration out. schindler-folliard 2005.
def ultimate_degree(w_cm: float, p_fa: float = 0.0, p_slag: float = 0.0) -> float:
    a = ALPHA_U_A * w_cm / (ALPHA_U_B + w_cm) + ALPHA_U_FA * p_fa + ALPHA_U_SLAG * p_slag
    return min(a, ALPHA_U_CAP)


# bogue compounds in, cement heat J/g out.
def cement_heat_j_per_g(
    p_c3s: float,
    p_c2s: float,
    p_c3a: float,
    p_c4af: float,
    p_so3: float,
    p_free_cao: float,
    p_mgo: float,
) -> float:
    return (
        500.0 * p_c3s
        + 260.0 * p_c2s
        + 866.0 * p_c3a
        + 420.0 * p_c4af
        + 624.0 * p_so3
        + 1186.0 * p_free_cao
        + 850.0 * p_mgo
    )


# blended binder heat. RETURNS J/kg not J/g. trap 1.
def ultimate_heat_j_per_kg(
    h_cem_j_per_g: float,
    p_cem: float,
    p_slag: float = 0.0,
    p_fa: float = 0.0,
    p_fa_cao: float = 0.0,
) -> float:
    h_j_per_g = h_cem_j_per_g * p_cem + 461.0 * p_slag + 1800.0 * p_fa_cao * p_fa
    return h_j_per_g * 1000.0


# cement chemistry in, hydration time parameter hours out.
def tau_hours(
    p_c3a: float,
    p_c3s: float,
    blaine_m2_kg: float,
    p_so3: float,
    p_slag: float = 0.0,
    p_fa: float = 0.0,
    p_fa_cao: float = 0.0,
) -> float:
    return float(
        66.78
        * p_c3a**-0.154
        * p_c3s**-0.401
        * blaine_m2_kg**-0.804
        * p_so3**-0.758
        * np.exp(2.187 * p_slag + 9.50 * p_fa * p_fa_cao)
    )


# equivalent age in, degree of hydration out.
def degree_of_hydration(
    t_e_h: Floats, alpha_u: float, tau_h: float, beta: float = BETA_DEFAULT
) -> FloatArray:
    t_e = np.maximum(np.asarray(t_e_h, dtype=np.float64), 1e-6)  # trap: overflow at t=0
    return np.asarray(alpha_u * np.exp(-((tau_h / t_e) ** beta)), dtype=np.float64)


# rate wrt equivalent age. 1/hour.
def d_alpha_d_te(
    t_e_h: Floats, alpha_u: float, tau_h: float, beta: float = BETA_DEFAULT
) -> FloatArray:
    t_e = np.maximum(np.asarray(t_e_h, dtype=np.float64), 1e-6)
    x = (tau_h / t_e) ** beta
    out = np.asarray(np.exp(-x), dtype=np.float64)
    out *= x
    out *= alpha_u * beta / t_e
    return np.asarray(out, dtype=np.float64)


# volumetric heat generation. W/m3. per cell.
def heat_rate_w_m3(
    t_e_h: Floats,
    temps_c: Floats,
    alpha_u: float,
    tau_h: float,
    beta: float,
    h_u_j_per_kg: float,
    c_c_kg_m3: float,
    t_ref_c: float = T_REF_DEFAULT_C,
) -> FloatArray:
    dadte_per_h = d_alpha_d_te(t_e_h, alpha_u, tau_h, beta)
    dadt_per_h = dadte_per_h * rate_multiplier(temps_c, t_ref_c)
    dadt_per_s = dadt_per_h / 3600.0  # TRAP: must be 1/s here
    return np.asarray(h_u_j_per_kg * c_c_kg_m3 * dadt_per_s, dtype=np.float64)
