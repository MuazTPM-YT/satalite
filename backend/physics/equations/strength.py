"""Strength-maturity. STUB - the calibration constants are not researched.

Every parameter below is mix-grade and aggregate specific. Inventing values here would
produce a smooth, plausible, completely wrong strength curve, which is the worst possible
failure mode for a formwork-striking decision. NotImplementedError until the numbers exist.

Elastic modulus deliberately absent - see SPEC-05 [34]. Displaying E(t) crosses the
"not structural analysis" boundary, and the deflection risk it appears to answer is
creep, which this model does not carry.
"""

from physics import FloatArray, Floats


# equivalent age in, compressive strength MPa out. exponential form.
def strength_mpa(t_e_h: Floats, s_u_mpa: float, tau_s_h: float, beta_s: float) -> FloatArray:
    raise NotImplementedError(
        "strength-maturity parameters not researched: s_u, tau_s and beta_s per US mix "
        "grade (4000/5000/6000 psi) must come from calibration data, not a guess."
    )


# fraction of 28-day strength reached. drives the formwork striking call.
def strength_fraction(t_e_h: Floats, s_u_mpa: float, tau_s_h: float, beta_s: float) -> FloatArray:
    raise NotImplementedError("blocked on strength_mpa - same missing calibration constants.")
