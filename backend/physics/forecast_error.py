"""How wrong FortyGuard's own forecasts turn out to be, measured against FortyGuard.

Scoring a forecast against a third-party observation network measures two things at
once: forecast skill, and the disagreement between two different sensors over two
different footprints. Scoring FortyGuard's past forecast for a tile against what
FortyGuard later reported for that same tile isolates the first and costs no extra quota,
because both halves are already sitting in the cache.

Pairing is on (tile_id, valid_time). Lead time is the gap between when the forecast was
issued and the hour it was forecasting.
"""

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from physics import FloatArray

LEAD_HOURS = tuple(range(1, 13))

# PROVISIONAL. Used only when no paired forecast/observation data exists yet. Linear
# growth from 0.5 degC at 1h to 2.0 degC at 12h - a plausible shape for a short-range
# near-surface forecast, NOT a measurement of this API. Replace on first real pairing.
PROVISIONAL_SIGMA_1H_C = 0.5
PROVISIONAL_SIGMA_12H_C = 2.0


# the fallback, kept separate so callers can see exactly what "provisional" contains.
def provisional_error() -> dict[str, Any]:
    lead_h = np.asarray(LEAD_HOURS, dtype=np.float64)
    sigma_c = np.interp(
        lead_h, [1.0, 12.0], [PROVISIONAL_SIGMA_1H_C, PROVISIONAL_SIGMA_12H_C]
    )
    return {
        "lead_h": lead_h.tolist(),
        "bias_c": [0.0] * len(LEAD_HOURS),
        "sigma_c": sigma_c.tolist(),
        "n_pairs": [0] * len(LEAD_HOURS),
        "provisional": True,
        "source": (
            "PROVISIONAL default: sigma grows linearly 0.5 degC at 1h to 2.0 degC at 12h, "
            "zero bias assumed. No paired forecast/observation data in the cache yet."
        ),
    }


# compare past 12h forecasts against what was later observed at the same tile.
def empirical_forecast_error(
    cached_forecasts: Sequence[Mapping[str, Any]],
    cached_observations: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    observed_c = {
        (row["tile_id"], row["valid_time"]): float(row["air_temp_c"])
        for row in cached_observations
    }

    errors_by_lead: dict[int, list[float]] = {lead: [] for lead in LEAD_HOURS}
    for row in cached_forecasts:
        lead = int(round(float(row["lead_h"])))
        if lead not in errors_by_lead:
            continue
        truth_c = observed_c.get((row["tile_id"], row["valid_time"]))
        if truth_c is None:
            continue
        errors_by_lead[lead].append(float(row["air_temp_c"]) - truth_c)

    if not any(errors_by_lead.values()):
        return provisional_error()

    bias_c: list[float] = []
    sigma_c: list[float] = []
    n_pairs: list[int] = []
    for lead in LEAD_HOURS:
        errors = np.asarray(errors_by_lead[lead], dtype=np.float64)
        n_pairs.append(int(errors.size))
        # a single pair gives a bias but no spread. nan, never a fabricated zero.
        bias_c.append(float(errors.mean()) if errors.size else float("nan"))
        sigma_c.append(float(errors.std(ddof=1)) if errors.size > 1 else float("nan"))

    return {
        "lead_h": [float(lead) for lead in LEAD_HOURS],
        "bias_c": bias_c,
        "sigma_c": _fill_gaps(np.asarray(sigma_c, dtype=np.float64)).tolist(),
        "n_pairs": n_pairs,
        "provisional": False,
        "source": (
            f"Measured from {sum(n_pairs)} cached FortyGuard forecast/observation pairs "
            "on matching tiles."
        ),
    }


# lead times with too few pairs get interpolated from the ones that have enough.
# Leaving nan would silently drop those hours out of the ensemble's ambient perturbation.
def _fill_gaps(sigma_c: FloatArray) -> FloatArray:
    known = ~np.isnan(sigma_c)
    if not known.any():
        return np.asarray(
            np.interp(
                np.asarray(LEAD_HOURS, dtype=np.float64),
                [1.0, 12.0],
                [PROVISIONAL_SIGMA_1H_C, PROVISIONAL_SIGMA_12H_C],
            ),
            dtype=np.float64,
        )
    index = np.arange(sigma_c.size, dtype=np.float64)
    return np.asarray(np.interp(index, index[known], sigma_c[known]), dtype=np.float64)
