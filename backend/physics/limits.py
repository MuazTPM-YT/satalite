"""Threshold checks. constants.py holds the numbers, this holds the decisions."""

from typing import Any

import numpy as np

from physics import FloatArray, Floats
from physics.constants import (
    CRACK_LIMIT_C,
    DEF_LIMIT_C,
    PLACEMENT_MAX_C,
)

# breach checks answer yes/no per element, so they need a bool array, not FloatArray.
BoolArray = np.ndarray[Any, np.dtype[np.bool_]]

# ACI 305R: above this, plastic shrinkage cracking is likely without protection.
EVAP_LIMIT_KG_M2_H = 1.0    # = 0.2 lb/ft2/h, the classic Uno nomograph line


# ettringite melts around 158 degF. Above that DEF is a mechanism, not a margin - so it
# is the ceiling even for a cement whose chemistry resists it. DEF_LIMIT_C (155 degF) is
# Reclamation's DESIGN maximum, deliberately below it.
DEF_ETTRINGITE_C = 70.0    # 158 degF, USBR DSO-12-02

# Heinz & Ludwig, quoted in USBR DSO-12-02: combinations below BOTH of these were less
# susceptible to DEF. Stated there on a percent basis (0.7% S/A, 2.0% S2/A). S/A is a
# ratio, so it is the same number whatever the units; S2/A is not, and 2.0 percent-basis
# becomes 0.020 on the mass-fraction basis these functions take. Getting that second
# conversion wrong is how a safety limit quietly moves.
SO3_OVER_AL2O3_MAX = 0.7      # dimensionless ratio, unit-invariant
SO3_SQ_OVER_AL2O3_MAX = 0.020  # mass-fraction basis, = 2.0 on a percent basis


# def risk depends on cement chemistry, not just temperature.
# heinz & ludwig: low SO3/Al2O3 ratios resist DEF even above the limit.
def def_threshold_c(so3_frac: float, al2o3_frac: float) -> float:
    if al2o3_frac <= 0.0:
        raise ValueError("al2o3_frac must be positive")
    if not 0.0 <= so3_frac <= 1.0 or not 0.0 <= al2o3_frac <= 1.0:
        raise ValueError("so3_frac and al2o3_frac are mass fractions 0-1, not percentages")

    resistant = (
        so3_frac / al2o3_frac < SO3_OVER_AL2O3_MAX
        and so3_frac**2 / al2o3_frac < SO3_SQ_OVER_AL2O3_MAX
    )
    # INTERPRETATION, flagged as such: DSO-12-02 says both Deer Creek placements exceeded
    # 155 degF and DEF was ruled out on this chemistry, but it never names the relaxed
    # number. Taking it as the 158 degF ettringite threshold is the most defensible
    # reading of the same document. Confirm before anyone relies on the relaxed branch.
    return DEF_ETTRINGITE_C if resistant else DEF_LIMIT_C


# peak core temperature past the DEF limit. delayed ettringite formation risk.
def breaches_def(peak_core_temp_c: Floats, threshold_c: float = DEF_LIMIT_C) -> BoolArray:
    return np.asarray(np.asarray(peak_core_temp_c, dtype=np.float64) > threshold_c)


# core-to-surface gradient past the cracking limit. thermal cracking risk.
def breaches_cracking(max_diff_c: Floats, limit_c: float = CRACK_LIMIT_C) -> BoolArray:
    return np.asarray(np.asarray(max_diff_c, dtype=np.float64) > limit_c)


# surface evaporation past ACI 305. kg/m2/s in, matching the solver's units.
def breaches_evaporation(
    evap_kg_m2_s: Floats, limit_kg_m2_h: float = EVAP_LIMIT_KG_M2_H
) -> BoolArray:
    rate_kg_m2_h = np.asarray(evap_kg_m2_s, dtype=np.float64) * 3600.0
    return np.asarray(rate_kg_m2_h > limit_kg_m2_h)


# fresh concrete placed hotter than ACI 305 allows.
def breaches_placement(placement_temp_c: Floats, limit_c: float = PLACEMENT_MAX_C) -> BoolArray:
    return np.asarray(np.asarray(placement_temp_c, dtype=np.float64) > limit_c)


# peak evaporation rate over a run, kg/m2/s. surface temps and weather already aligned.
def peak_evaporation_kg_m2_s(evap_kg_m2_s: FloatArray) -> float:
    return float(np.max(evap_kg_m2_s))
