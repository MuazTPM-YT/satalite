"""Strength-maturity, PROVISIONAL calibration.

Deliberately NOT in physics/equations/strength.py. That module stays a stub because it
promises calibrated constants and we do not have them. This module makes the same
exponential form usable with openly-guessed parameters, so every caller can see the
values it is trusting and swap them for measured ones later.

    S(t_e) = S_u * exp(-(tau_s / t_e) ** beta_s)          ASTM C1074 / Carino

Read the numbers below as a placeholder shape, not as this mix's strength. The
FRACTION of 28-day strength is the safer of the two outputs: S_u cancels out of it, so
only tau_s and beta_s matter and the absolute-strength guess never reaches the caller.
"""

from dataclasses import dataclass

import numpy as np

from physics import FloatArray, Floats

# 28 days of equivalent age at the reference temperature. what "28-day strength" means.
# named AGE_ not T_: the naming test reads a leading T_ as a temperature, and this is time.
AGE_28_H = 672.0


@dataclass(frozen=True)
class StrengthParams:
    """One grade's exponential fit. Every field PROVISIONAL until calibrated."""

    s_u_mpa: float      # ultimate strength, ~1.15x the nominal 28-day value
    tau_s_h: float      # time parameter, equivalent age hours
    beta_s: float       # shape exponent


# PROVISIONAL. Nominal grades converted from psi, ultimate taken as 1.15x nominal, and
# tau_s/beta_s set mid-range for ordinary Type I/II mixes. NOT measured on any mix here.
# A 20% fly ash replacement pushes tau_s up (slower early gain); that shift is not
# modelled, so early-age fractions below are optimistic for the standard mix.
GRADE_PARAMS = {
    "4000psi": StrengthParams(s_u_mpa=31.7, tau_s_h=20.0, beta_s=0.85),
    "5000psi": StrengthParams(s_u_mpa=39.6, tau_s_h=18.0, beta_s=0.88),
    "6000psi": StrengthParams(s_u_mpa=47.6, tau_s_h=16.0, beta_s=0.90),
}


# grade name in, fit parameters out. unknown grade is a loud error, never a default.
def params_for(grade: str) -> StrengthParams:
    try:
        return GRADE_PARAMS[grade]
    except KeyError:
        raise ValueError(
            f"unknown grade {grade!r}, expected one of {sorted(GRADE_PARAMS)}"
        ) from None


# equivalent age in, compressive strength MPa out.
def strength_mpa(t_e_h: Floats, params: StrengthParams) -> FloatArray:
    t_e = np.maximum(np.asarray(t_e_h, dtype=np.float64), 1e-6)  # exp overflows at t=0
    return np.asarray(params.s_u_mpa * np.exp(-((params.tau_s_h / t_e) ** params.beta_s)),
                      dtype=np.float64)


# fraction of 28-day strength reached. drives the formwork striking call.
def strength_fraction(t_e_h: Floats, params: StrengthParams) -> FloatArray:
    s_28_mpa = float(strength_mpa(AGE_28_H, params))
    return np.asarray(strength_mpa(t_e_h, params) / s_28_mpa, dtype=np.float64)
