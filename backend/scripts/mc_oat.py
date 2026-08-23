"""TASK 2 - which of the sampled parameters actually own the variance?

One at a time: move one parameter to each end of its own marginal, hold every other one
at nominal, solve deterministically. The swing between the two ends is that parameter's
OAT contribution.

Run:  cd backend && .venv/bin/python -m scripts.mc_oat

READ THE CAVEAT PRINTED AT THE END. OAT cannot see interactions and this model has a
real one, so a small swing here is not proof that a parameter is unimportant.
"""

from dataclasses import replace

import numpy as np
from scipy.stats import norm

from physics.constants import EA_BASE, SOLAR_ABSORPTIVITY
from physics.forecast_error import provisional_error
from physics.season_analysis import (
    PLACEMENT_ABOVE_AMBIENT_C,
    SIM_HOURS,
    STANDARD_ELEMENT,
    STANDARD_GRADE,
    DayWeather,
    build_ambient,
    deterministic_strip_time_h,
    standard_mix,
)
from physics.types import Ambient, Element, Mix
from physics.uncertainty import ParamSample, _run_one, _sigma_on_hours, shift_ambient
from scripts import _results

# same fixed day as scripts/mc_noise.py, so the two tasks describe the same case.
HOT_DAY = DayWeather(
    date="2025-07-15", day_of_year=196, t_min_c=30.0, t_mean_c=36.5, t_max_c=43.0
)
LAT_DEG = 33.45
PLACEMENT_HOUR = 14

# ensemble mesh, not the 10 mm production mesh: these swings are meant to be compared
# against the band the ensemble publishes, and the ensemble runs at 20 mm / 30 s.
OPTIONS = {"dt_s": 30.0, "hours": SIM_HOURS, "record_every_s": 600.0, "adiabatic": False}

Z95 = float(norm.ppf(0.95))
SMALL_SWING_C = 0.1


# nominal draw: every parameter at the value a plain deterministic run would use.
def nominal(mix: Mix) -> ParamSample:
    return ParamSample(
        placement_temp_offset_c=0.0,
        h_multiplier=1.0,
        tau_h=mix.tau_h,
        beta=mix.beta,
        a_solar=SOLAR_ABSORPTIVITY,
        k_w_m_k=mix.k_w_m_k,
        rho_cp_j_m3_k=mix.rho_kg_m3 * mix.cp_j_kg_k,
        ea_j_mol=EA_BASE,
        h_cem_j_per_g=mix.h_cem_j_per_g,
        forecast_z=0.0,
    )


# p05 and p95 of each sampled marginal, matching draw_parameters exactly.
#
# Percentiles, not clipped bounds: the normals have no "end", and a p05-to-p95 swing is
# the thing that is directly comparable with a p05/p95 band. For the two uniforms that
# sits just inside the full range.
def ends(mix: Mix) -> dict[str, tuple[float, float]]:
    rho_cp = mix.rho_kg_m3 * mix.cp_j_kg_k
    return {
        "placement_temp_offset_c": (-3.0 * Z95, 3.0 * Z95),
        "h_multiplier": (
            float(np.exp(-Z95 * np.log(2.0) / 2.0)),
            float(np.exp(Z95 * np.log(2.0) / 2.0)),
        ),
        "tau_h": (mix.tau_h * (1.0 - 0.15 * Z95), mix.tau_h * (1.0 + 0.15 * Z95)),
        "beta": (mix.beta * (1.0 - 0.10 * Z95), mix.beta * (1.0 + 0.10 * Z95)),
        "a_solar": (0.50 + 0.15 * 0.05, 0.50 + 0.15 * 0.95),
        "k_w_m_k": (mix.k_w_m_k * (1.0 - 0.075 * Z95), mix.k_w_m_k * (1.0 + 0.075 * Z95)),
        "rho_cp_j_m3_k": (rho_cp * (1.0 - 0.075 * Z95), rho_cp * (1.0 + 0.075 * Z95)),
        "ea_j_mol": (33000.0 + 9000.0 * 0.05, 33000.0 + 9000.0 * 0.95),
        "h_cem_j_per_g": (
            mix.h_cem_j_per_g * (1.0 - 0.08 * Z95),
            mix.h_cem_j_per_g * (1.0 + 0.08 * Z95),
        ),
        "forecast_z": (-Z95, Z95),
    }


# one deterministic solve through the ensemble's own worker, so nothing can drift.
def run(element: Element, mix: Mix, ambient: Ambient, sample: ParamSample) -> tuple[float, ...]:
    shifted = shift_ambient(
        ambient, sample.forecast_z, _sigma_on_hours(provisional_error(), ambient.hours)
    )
    result = _run_one((element, mix, shifted, sample, OPTIONS))
    return (
        result.peak_core_temp_c,
        result.peak_core_time_h,
        deterministic_strip_time_h(result, STANDARD_GRADE),
        result.max_core_temp_anywhere_c,
    )


def main() -> None:
    ambient = build_ambient(HOT_DAY, LAT_DEG, PLACEMENT_HOUR, hours=SIM_HOURS)
    mix = standard_mix()
    element = replace(
        STANDARD_ELEMENT,
        dx_m=0.02,
        placement_temp_c=float(ambient.air_temp_c[0]) + PLACEMENT_ABOVE_AMBIENT_C,
    )

    base = nominal(mix)
    base_peak_c, base_time_h, base_strip_h, base_hot_c = run(element, mix, ambient, base)
    print(f"case: {HOT_DAY.date} placement hour {PLACEMENT_HOUR}, "
          f"placement {element.placement_temp_c:.1f} C, dx 0.02 m, dt 30 s, {SIM_HOURS:.0f} h")
    print(f"nominal: peak core {base_peak_c:.3f} C at {base_time_h:.2f} h, "
          f"hottest anywhere {base_hot_c:.3f} C, strip {base_strip_h:.2f} h\n")

    rows = []
    for name, (low, high) in ends(mix).items():
        lo = run(element, mix, ambient, replace(base, **{name: low}))
        hi = run(element, mix, ambient, replace(base, **{name: high}))
        rows.append((name, low, high, lo, hi))

    rows.sort(key=lambda r: -abs(r[4][0] - r[3][0]))

    header = f"{'parameter':>24} {'p05':>10} {'p95':>10} {'dPeak C':>9} " \
             f"{'dHottest C':>11} {'dPeak t h':>10} {'dStrip h':>9} {'share %':>8}"
    print(header)
    print("-" * len(header))

    # share of the summed absolute peak-core swing. NOT a variance decomposition: OAT
    # swings do not add up to the band, so this ranks contributors, it does not partition.
    total_swing_c = sum(abs(hi[0] - lo[0]) for _, _, _, lo, hi in rows)
    table = {}
    for name, low, high, lo, hi in rows:
        share_pct = 100.0 * abs(hi[0] - lo[0]) / total_swing_c
        table[name] = {
            "p05": low, "p95": high,
            "d_peak_core_c": hi[0] - lo[0],
            "d_max_core_anywhere_c": hi[3] - lo[3],
            "d_peak_time_h": hi[1] - lo[1],
            "d_strip_time_h": hi[2] - lo[2],
            "share_of_summed_swing_pct": share_pct,
            "low_end": {"peak_core_c": lo[0], "peak_time_h": lo[1], "strip_h": lo[2]},
            "high_end": {"peak_core_c": hi[0], "peak_time_h": hi[1], "strip_h": hi[2]},
        }
        print(
            f"{name:>24} {low:>10.4g} {high:>10.4g} {hi[0] - lo[0]:>9.3f} "
            f"{hi[3] - lo[3]:>11.3f} {hi[1] - lo[1]:>10.2f} {hi[2] - lo[2]:>9.2f} "
            f"{share_pct:>8.1f}"
        )

    top_name = rows[0][0]
    top_share = table[top_name]["share_of_summed_swing_pct"]
    small = [name for name, _, _, lo, hi in rows if abs(hi[0] - lo[0]) < SMALL_SWING_C]
    print(f"\nlargest single contributor: {top_name}, "
          f"{abs(rows[0][4][0] - rows[0][3][0]):.3f} C swing, {top_share:.1f}% of the summed swing")
    print(f"swing below {SMALL_SWING_C} C in peak core: {small or 'none'}")
    print(
        "\nCAVEAT: one-at-a-time misses interactions. Arrhenius rate depends on\n"
        "temperature and hydration heat feeds back into temperature, so T_placement,\n"
        "E_a, tau and H_cem all push the same feedback loop and their joint effect is\n"
        "larger than the sum of these columns."
    )

    path = _results.write("mc-oat", {
        "case": {
            "date": HOT_DAY.date, "placement_hour": PLACEMENT_HOUR, "hours": SIM_HOURS,
            "lat_deg": LAT_DEG, "placement_temp_c": element.placement_temp_c,
            "dx_m": 0.02, "dt_s": OPTIONS["dt_s"], "z95": Z95,
            "small_swing_c": SMALL_SWING_C,
        },
        "nominal": {
            "peak_core_temp_c": base_peak_c,
            "peak_core_time_h": base_time_h,
            "strip_time_h": base_strip_h,
        },
        "ranked_by_peak_core_swing": list(table),
        "parameters": table,
        "largest_contributor": {"name": top_name, "share_pct": top_share},
        "below_small_swing_c": small,
        "caveat": (
            "one-at-a-time misses interactions; Arrhenius rate depends on T and "
            "hydration heat feeds back into T, so the feedback-loop parameters "
            "(placement_temp_offset_c, ea_j_mol, tau_h, h_cem_j_per_g) are understated"
        ),
    })
    print(f"\nwrote {path}")


# non-fork start method re-imports this module in every worker, so keep the guard even
# though this script never builds a pool.
if __name__ == "__main__":
    main()
