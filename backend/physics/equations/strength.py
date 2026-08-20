"""Strength-maturity and stiffness. STUB - the calibration constants are not researched.

Every parameter below is mix-grade and aggregate specific. Inventing values here would
produce a smooth, plausible, completely wrong strength curve, which is the worst possible
failure mode for a formwork-striking decision. NotImplementedError until the numbers exist.
"""

from physics import FloatArray, Floats


# equivalent age in, compressive strength MPa out. exponential form.
def strength_mpa(t_e_h: Floats, s_u_mpa: float, tau_s_h: float, beta_s: float) -> FloatArray:
    raise NotImplementedError(
        "strength-maturity parameters not researched: s_u, tau_s and beta_s per US mix "
        "grade (4000/5000/6000 psi) must come from calibration data, not a guess."
    )


# fib MC2010 elastic modulus: 21.5 * alpha_e * (fc/10)**0.3, GPa.
def elastic_modulus_gpa(fc_28_mpa: float, alpha_e: float = 1.0) -> float:
    raise NotImplementedError(
        "fib MC2010 modulus needs alpha_e for the actual aggregate type "
        "(basalt 1.2, quartzite 1.0, limestone 0.9, sandstone 0.7). Not yet specified."
    )


# fraction of 28-day strength reached. drives the formwork striking call.
def strength_fraction(t_e_h: Floats, s_u_mpa: float, tau_s_h: float, beta_s: float) -> FloatArray:
    raise NotImplementedError("blocked on strength_mpa - same missing calibration constants.")
