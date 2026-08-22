"""TASK 1 - how much of the published p05/p95 band is sampling noise?

The ensemble reports band edges to a tenth of a degree. Nobody has measured how much
those edges move when only the seed changes. Same case, same N, different seed: any
movement is pure Monte Carlo noise, because the physics did not change.

Run:  cd backend && .venv/bin/python -m scripts.mc_noise

Costs about 17 minutes. Reports only - changes nothing, and does not touch the default
sample count.
"""

import time

import numpy as np

from physics.forecast_error import provisional_error
from physics.season_analysis import (
    PLACEMENT_ABOVE_AMBIENT_C,
    SIM_HOURS,
    STANDARD_ELEMENT,
    STANDARD_GRADE,
    DayWeather,
    build_ambient,
    standard_mix,
)
from physics.types import Ambient, Element, Mix
from physics.uncertainty import run_ensemble

# one fixed hot Phoenix day. STATED, not measured: no season is in the cache, so the
# day is written down here rather than pulled, and every run uses this same one.
HOT_DAY = DayWeather(
    date="2025-07-15", day_of_year=196, t_min_c=30.0, t_mean_c=36.5, t_max_c=43.0
)
LAT_DEG = 33.45
PLACEMENT_HOUR = 14

SAMPLE_COUNTS = (64, 128, 300, 600)
SEEDS = (0, 1, 2, 3, 4)
CRITERION_C = 0.1


# the production case: standard element, standard mix, ensemble mesh, forecast spread on.
def case() -> tuple[Element, Mix, Ambient]:
    ambient = build_ambient(HOT_DAY, LAT_DEG, PLACEMENT_HOUR, hours=SIM_HOURS)
    placed = Element(
        shape=STANDARD_ELEMENT.shape,
        dims_mm=STANDARD_ELEMENT.dims_mm,
        dx_m=STANDARD_ELEMENT.dx_m,
        placement_temp_c=float(ambient.air_temp_c[0]) + PLACEMENT_ABOVE_AMBIENT_C,
        formwork=STANDARD_ELEMENT.formwork,
        on_ground=STANDARD_ELEMENT.on_ground,
    )
    return placed, standard_mix(), ambient


# p05 and p95 of peak core temperature for one (n, seed). degC.
def band_edges_c(
    element: Element, mix: Mix, ambient: Ambient, n: int, seed: int
) -> tuple[float, float]:
    ensemble = run_ensemble(
        element,
        mix,
        ambient,
        n=n,
        seed=seed,
        hours=SIM_HOURS,
        grade=STANDARD_GRADE,
        forecast_sigma_c=provisional_error(),
    )
    p05, p95 = np.percentile(ensemble.peak_core_temp_c(), [5.0, 95.0])
    return float(p05), float(p95)


def main() -> None:
    element, mix, ambient = case()
    print(f"case: {HOT_DAY.date} placement hour {PLACEMENT_HOUR}, "
          f"placement {element.placement_temp_c:.1f} C, dx 0.02 m, dt 30 s, {SIM_HOURS:.0f} h")
    print(f"seeds: {list(SEEDS)}\n")

    header = f"{'N':>5} {'p05 mean':>9} {'p05 sd':>7} {'p05 rng':>8} " \
             f"{'p95 mean':>9} {'p95 sd':>7} {'p95 rng':>8} {'width':>7} {'wall s':>7}"
    print(header)
    print("-" * len(header))

    for n in SAMPLE_COUNTS:
        started = time.perf_counter()
        edges = np.asarray(
            [band_edges_c(element, mix, ambient, n, seed) for seed in SEEDS],
            dtype=np.float64,
        )
        elapsed_s = time.perf_counter() - started
        p05, p95 = edges[:, 0], edges[:, 1]
        print(
            f"{n:>5} {p05.mean():>9.3f} {p05.std(ddof=1):>7.3f} {np.ptp(p05):>8.3f} "
            f"{p95.mean():>9.3f} {p95.std(ddof=1):>7.3f} {np.ptp(p95):>8.3f} "
            f"{(p95 - p05).mean():>7.3f} {elapsed_s:>7.1f}"
        )

    print(f"\ncriterion: seed-to-seed sd of both band edges below {CRITERION_C} C.")
    print("sd from 5 seeds is itself uncertain by roughly +/-30%, so treat 0.07-0.15 C")
    print("as too close to call rather than a pass or a fail.")


# non-fork start method re-imports this module in every worker. without the guard the
# workers try to build their own pool.
if __name__ == "__main__":
    main()
