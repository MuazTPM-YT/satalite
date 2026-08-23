"""TASK 2 - which part of the surface treatment drags the scheme down to first order?

The stored dx sweep gives p = log2(0.2142 / 0.1210) = 0.82 on peak core temperature.
That is first order, not second. The adiabatic case cannot discriminate: with every face
sealed the field stays spatially uniform and exact at every dx, so there is no dx error
to measure at all. Arm D runs it anyway, as a control that shows the degeneracy.

Run:  cd backend && .venv/bin/python -m scripts.grid_order

Arms, all four spacings, same dt policy so the arms are comparable step for step:
  A baseline  both surface paths on, reproduces the stored sweep
  B q off     solar and evaporation off, so only the h path drives the surface
  C h off     h_multiplier 0, so only the q path drives the surface
  D adiabatic every face sealed, the control
  E, F       q dialled to half and full strength with evaporation off, a dose-response
             that says whether the mesh error tracks q

Width is 60 mm, not the standard 3000 mm. A slab's side faces are ADIABATIC symmetry
planes, so the answer is one dimensional in y and the stored width_check already showed
3000 mm and 100 mm agreeing to fourteen digits. 60 mm divides exactly by 5, 10, 15 and
20 mm, so no spacing gets a rounded cell count. main() re-checks this against the stored
number before trusting it.
"""

import math
import time
from dataclasses import asdict, dataclass

from physics.equations import conduction
from physics.geometry import rasterize
from physics.season_analysis import (
    PLACEMENT_ABOVE_AMBIENT_C,
    SIM_HOURS,
    STANDARD_ELEMENT,
    DayWeather,
    build_ambient,
    standard_mix,
)
from physics.solver import _worst_case_h_sum, solve
from physics.types import Ambient, Element, Mix
from scripts import _results

# same fixed day as scripts/grid_cost.py, scripts/mc_noise.py and scripts/mc_oat.py.
HOT_DAY = DayWeather(
    date="2025-07-15", day_of_year=196, t_min_c=30.0, t_mean_c=36.5, t_max_c=43.0
)
LAT_DEG = 33.45
PLACEMENT_HOUR = 14

SPACINGS_M = (0.005, 0.010, 0.015, 0.020)
WIDTH_MM = 60.0

# same factor at every spacing and in every arm, so dt falls as dx**2 and the temporal
# truncation error shrinks faster than the spatial one. The h in the limit is always the
# baseline worst case, even in the arms that switch a path off - a shared dt is what
# makes the arms comparable.
SAFETY = 0.35

# ten times finer than grid_cost.py. Each arm records the peak on its own time grid
# because dt differs per spacing, and at 600 s that sampling offset was an estimated
# 0.003 C of noise on a 0.12 C signal. At 60 s it is a hundredth of that.
RECORD_EVERY_S = 60.0

ARMS = {
    "A_baseline": {},
    "B_q_off": {"solar_absorptivity": 0.0, "evaporative_cooling": False},
    "C_h_off": {"h_multiplier": 0.0},
    "D_adiabatic": {"adiabatic": True},
    # dose-response on q with evaporation switched off, so q is exactly a_s * GHI and
    # nothing about it depends on the surface state. If the mesh error is proportional
    # to q it has to fall roughly in step with a_s across these three.
    "E_q_half": {"solar_absorptivity": 0.275, "evaporative_cooling": False},
    "F_q_full": {"solar_absorptivity": 0.550, "evaporative_cooling": False},
}


# biggest dt the explicit scheme tolerates on this mesh, seconds. worst-case surface film.
def stability_limit_s(element: Element, mix: Mix, ambient: Ambient) -> float:
    section = rasterize(element.shape, element.dims_mm, element.dx_m, element.on_ground)
    return conduction.max_stable_dt_s(
        section.mask,
        _worst_case_h_sum(section, ambient),
        section.dx_m,
        mix.alpha_m2_s,
        mix.k_w_m_k,
    )


@dataclass(frozen=True)
class Row:
    """One deterministic solve, one arm, one spacing."""

    peak_core_temp_c: float
    peak_core_time_h: float
    max_core_surface_diff_c: float
    max_core_temp_anywhere_c: float
    probe_xy_m: tuple[float, float]
    cells: int
    limit_s: float
    dt_s: float
    record_every_s: float
    wall_s: float


# one deterministic solve at a stated spacing, with one arm's overrides applied.
def measure(
    ambient: Ambient, mix: Mix, dx_m: float, width_mm: float, **overrides: object
) -> Row:
    element = Element(
        shape=STANDARD_ELEMENT.shape,
        dims_mm={"width": width_mm, "thickness": STANDARD_ELEMENT.dims_mm["thickness"]},
        dx_m=dx_m,
        placement_temp_c=float(ambient.air_temp_c[0]) + PLACEMENT_ABOVE_AMBIENT_C,
        formwork=STANDARD_ELEMENT.formwork,
        on_ground=STANDARD_ELEMENT.on_ground,
    )
    limit_s = stability_limit_s(element, mix, ambient)
    dt_s = SAFETY * limit_s
    cells = int(rasterize(element.shape, element.dims_mm, dx_m, element.on_ground).mask.sum())

    started = time.perf_counter()
    result = solve(
        element,
        mix,
        ambient,
        dt_s=dt_s,
        hours=SIM_HOURS,
        record_every_s=RECORD_EVERY_S,
        **overrides,  # type: ignore[arg-type]
    )
    return Row(
        peak_core_temp_c=result.peak_core_temp_c,
        peak_core_time_h=result.peak_core_time_h,
        max_core_surface_diff_c=result.max_core_surface_diff_c,
        max_core_temp_anywhere_c=result.max_core_temp_anywhere_c,
        probe_xy_m=result.probe_xy_m,
        cells=cells,
        limit_s=limit_s,
        dt_s=dt_s,
        record_every_s=RECORD_EVERY_S,
        wall_s=time.perf_counter() - started,
    )


# observed order from the 5/10/20 mm triplet, plus the Richardson value it implies.
# None when the successive differences are too small to divide - which is what an
# exactly mesh-independent arm looks like.
def convergence(values: dict[float, float], floor_c: float = 1e-9) -> dict[str, object]:
    fine, mid, coarse = values[0.005], values[0.010], values[0.020]
    d_fine, d_coarse = fine - mid, mid - coarse
    if abs(d_fine) < floor_c or abs(d_coarse) < floor_c or d_coarse / d_fine <= 0.0:
        return {
            "d_5_10_c": d_fine,
            "d_10_20_c": d_coarse,
            "ratio": None,
            "order_p": None,
            "richardson_c": None,
            "note": "differences below the floor or opposite in sign - order undefined",
        }
    ratio = d_coarse / d_fine
    p = math.log2(ratio)
    return {
        "d_5_10_c": d_fine,
        "d_10_20_c": d_coarse,
        "ratio": ratio,
        "order_p": p,
        "richardson_c": fine + d_fine / (2.0**p - 1.0),
        "note": None,
    }


def main() -> None:
    ambient = build_ambient(HOT_DAY, LAT_DEG, PLACEMENT_HOUR, hours=SIM_HOURS)
    mix = standard_mix()

    # the 60 mm strip has to reproduce the stored 3000 mm number before any arm is read.
    # if it does not, every order below is measuring the width change instead.
    stored_3000mm_10mm_c = 61.522535973074
    check = measure(ambient, mix, 0.010, WIDTH_MM)
    width_delta_c = check.peak_core_temp_c - stored_3000mm_10mm_c
    print(f"width check, dx 10 mm: {WIDTH_MM:.0f} mm strip gives "
          f"{check.peak_core_temp_c:.12f} C against the stored 3000 mm "
          f"{stored_3000mm_10mm_c:.12f} C, delta {width_delta_c:+.2e} C")
    print("  (the stored value was recorded at 600 s frame cadence, this at "
          f"{RECORD_EVERY_S:.0f} s - a small delta is the cadence, not the width)\n")

    results: dict[str, dict[float, Row]] = {}
    for arm, overrides in ARMS.items():
        print(f"{arm}  {overrides if overrides else '(no overrides)'}")
        header = f"  {'dx mm':>6} {'cells':>6} {'dt s':>7} {'peak C':>12} " \
                 f"{'hottest C':>11} {'peak t h':>9} {'dT c-s C':>9} {'wall s':>7}"
        print(header)
        rows: dict[float, Row] = {}
        for dx_m in SPACINGS_M:
            row = measure(ambient, mix, dx_m, WIDTH_MM, **overrides)
            rows[dx_m] = row
            print(f"  {dx_m * 1000:>6.0f} {row.cells:>6} {row.dt_s:>7.2f} "
                  f"{row.peak_core_temp_c:>12.6f} {row.max_core_temp_anywhere_c:>11.6f} "
                  f"{row.peak_core_time_h:>9.3f} {row.max_core_surface_diff_c:>9.4f} "
                  f"{row.wall_s:>7.1f}")
        results[arm] = rows
        conv = convergence({dx: r.peak_core_temp_c for dx, r in rows.items()})
        if conv["order_p"] is None:
            print(f"  order: UNDEFINED - {conv['note']} "
                  f"(d 5-10 = {conv['d_5_10_c']:+.3e}, d 10-20 = {conv['d_10_20_c']:+.3e})\n")
        else:
            print(f"  order: d 5-10 = {conv['d_5_10_c']:+.6f} C, "
                  f"d 10-20 = {conv['d_10_20_c']:+.6f} C, "
                  f"ratio {conv['ratio']:.4f}, p = {conv['order_p']:.4f}, "
                  f"Richardson {conv['richardson_c']:.6f} C\n")

    print("summary, observed order p on peak core temperature:")
    for arm, rows in results.items():
        conv = convergence({dx: r.peak_core_temp_c for dx, r in rows.items()})
        p = conv["order_p"]
        print(f"  {arm:<12} p = {'undefined' if p is None else f'{p:.4f}'}")

    _results.write("grid-order", {
        "case": {
            "date": HOT_DAY.date, "placement_hour": PLACEMENT_HOUR, "hours": SIM_HOURS,
            "lat_deg": LAT_DEG, "safety_factor": SAFETY,
            "width_mm": WIDTH_MM, "thickness_mm": STANDARD_ELEMENT.dims_mm["thickness"],
            "record_every_s": RECORD_EVERY_S,
            "probe": "section centroid, bilinear",
        },
        "width_check": {
            "stored_3000mm_dx10_peak_core_c": stored_3000mm_10mm_c,
            "strip_dx10_peak_core_c": check.peak_core_temp_c,
            "delta_c": width_delta_c,
        },
        "arms": {
            arm: {
                "overrides": {k: v for k, v in ARMS[arm].items()},
                "spacings": {f"{dx * 1000:.0f}mm": asdict(r) for dx, r in rows.items()},
                "convergence": convergence({dx: r.peak_core_temp_c for dx, r in rows.items()}),
            }
            for arm, rows in results.items()
        },
    })


# non-fork start method re-imports this module in every worker. keep the guard.
if __name__ == "__main__":
    main()
