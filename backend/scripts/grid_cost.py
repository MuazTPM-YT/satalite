"""TASK 5 - what does a coarser mesh actually cost, in degrees and in seconds?

ANSWERED, and the answer changed once the q attenuation landed. It used to be dear:
20 mm cost 0.335 C against the 5 mm reference and golden test 5 sat at 0.0978 C against
a 0.1 C assertion, 2 percent of headroom. The missing q*h*dx/(2k) term was carrying all
of it. Now 10 mm costs -0.004 C, 15 mm -0.013 C and 20 mm +0.031 C, and golden 5 reads
0.000368 C. The ensemble's 20 mm mesh is defensible on these numbers; before, it was not
measured at all.

Run:  cd backend && .venv/bin/python -m scripts.grid_cost

dt is NOT auto-scaled anywhere in the solver - it is a caller argument. This script sets
it from the stability limit at each spacing, the same way golden test 5 does it by hand,
and prints the limit alongside so the margin is visible rather than assumed.
"""

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

# same fixed day as scripts/mc_noise.py and scripts/mc_oat.py.
HOT_DAY = DayWeather(
    date="2025-07-15", day_of_year=196, t_min_c=30.0, t_mean_c=36.5, t_max_c=43.0
)
LAT_DEG = 33.45
PLACEMENT_HOUR = 14

SPACINGS_M = (0.005, 0.010, 0.015, 0.020)

# fraction of the explicit limit to run at. Same factor at every spacing, so dt falls as
# dx**2 and the temporal truncation error shrinks with the spatial one - the convention
# golden test 5 uses. A per-spacing safety factor would confound the two.
SAFETY = 0.35
RECORD_EVERY_S = 600.0


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
    """One deterministic solve at one spacing."""

    peak_core_temp_c: float
    peak_core_time_h: float
    max_core_surface_diff_c: float
    max_core_temp_anywhere_c: float
    probe_xy_m: tuple[float, float]
    cells: int
    limit_s: float
    dt_s: float
    wall_s: float


# one deterministic solve at a stated spacing. returns the row.
def measure(ambient: Ambient, mix: Mix, dx_m: float, width_mm: float) -> Row:
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
        element, mix, ambient, dt_s=dt_s, hours=SIM_HOURS, record_every_s=RECORD_EVERY_S
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
        wall_s=time.perf_counter() - started,
    )


def main() -> None:
    ambient = build_ambient(HOT_DAY, LAT_DEG, PLACEMENT_HOUR, hours=SIM_HOURS)
    mix = standard_mix()
    width_mm = STANDARD_ELEMENT.dims_mm["width"]

    print(f"case: {HOT_DAY.date} placement hour {PLACEMENT_HOUR}, {SIM_HOURS:.0f} h, "
          f"slab {width_mm:.0f} x {STANDARD_ELEMENT.dims_mm['thickness']:.0f} mm")
    print(f"dt = {SAFETY} x stability limit at every spacing. "
          f"peak time resolution is {RECORD_EVERY_S / 3600.0:.3f} h (frame cadence)\n")

    header = f"{'dx mm':>6} {'cells':>7} {'limit s':>8} {'dt s':>7} " \
             f"{'peak C':>8} {'hottest C':>10} {'probe y mm':>11} " \
             f"{'peak t h':>9} {'dT c-s C':>9} {'wall s':>7}"
    print(header)
    print("-" * len(header))

    rows = {}
    for dx_m in SPACINGS_M:
        row = measure(ambient, mix, dx_m, width_mm)
        rows[dx_m] = row
        print(f"{dx_m * 1000:>6.0f} {row.cells:>7} {row.limit_s:>8.2f} {row.dt_s:>7.2f} "
              f"{row.peak_core_temp_c:>8.3f} {row.max_core_temp_anywhere_c:>10.3f} "
              f"{row.probe_xy_m[1] * 1000:>11.1f} {row.peak_core_time_h:>9.2f} "
              f"{row.max_core_surface_diff_c:>9.3f} {row.wall_s:>7.1f}")

    reference = rows[SPACINGS_M[0]]
    print("\nagainst the 5 mm reference:")
    for dx_m in SPACINGS_M[1:]:
        row = rows[dx_m]
        d_peak_c = row.peak_core_temp_c - reference.peak_core_temp_c
        d_hot_c = row.max_core_temp_anywhere_c - reference.max_core_temp_anywhere_c
        d_time_h = row.peak_core_time_h - reference.peak_core_time_h
        print(f"  {dx_m * 1000:>2.0f} mm  peak {d_peak_c:+.3f} C  hottest {d_hot_c:+.3f} C  "
              f"peak t {d_time_h:+.2f} h  {reference.wall_s / row.wall_s:>5.1f}x faster")

    # a slab's side faces are tagged ADIABATIC (symmetry planes), so every column of the
    # mesh sees identical conditions and the 3000 mm width is pure presentation. If that
    # is true the answer must not move when the width shrinks - and the run gets 30x
    # cheaper for nothing. Measured, not assumed.
    print("\nwidth is a symmetry-plane strip: does narrowing it change the answer?")
    widths = {}
    for narrow_mm in (width_mm, 100.0):
        row = measure(ambient, mix, 0.010, narrow_mm)
        widths[narrow_mm] = row
        print(f"  width {narrow_mm:>6.0f} mm, dx 10 mm: {row.cells:>6} cells, "
              f"peak {row.peak_core_temp_c:.6f} C at {row.peak_core_time_h:.2f} h, "
              f"{row.wall_s:.2f} s")

    _results.write("grid-cost", {
        "case": {
            "date": HOT_DAY.date, "placement_hour": PLACEMENT_HOUR, "hours": SIM_HOURS,
            "lat_deg": LAT_DEG, "safety_factor": SAFETY,
            "width_mm": width_mm, "thickness_mm": STANDARD_ELEMENT.dims_mm["thickness"],
            "probe": "section centroid, bilinear",
        },
        "spacings": {f"{dx_m * 1000:.0f}mm": asdict(row) for dx_m, row in rows.items()},
        "width_check": {f"{w:.0f}mm": asdict(row) for w, row in widths.items()},
    })


# non-fork start method re-imports this module in every worker. keep the guard.
if __name__ == "__main__":
    main()
