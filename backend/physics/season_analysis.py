"""Replay a whole season against ONE fixed element. This produces the impact number.

THE STANDARD ELEMENT BELOW WAS FIXED ON 2026-08-22 AND MUST NEVER BE RETUNED.

It is an ordinary suspended slab - the commonest thing anyone pours - chosen before a
single day of the season had been run, so nothing about it was selected to make the
result look bigger. Changing any of its dimensions, its mix, or its formwork after
seeing a season result invalidates every number this module has ever produced. A small
true number beats a large questionable one. If it must change, change it and rerun the
whole season, and say in the write-up that it changed.

Deterministic solves only. 92 days x 2 placement hours is 184 runs; running the 300
sample ensemble on each would be 55,200 and buys nothing, because the season statistic
is a count of breaches, not a confidence interval. The ensemble runs once, on the single
headline day the UI shows.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date as date_type
from statistics import mean, median
from typing import Any

import numpy as np

from physics import FloatArray
from physics.constants import (
    BETA_DEFAULT,
    CRACK_LIMIT_C,
    DEF_LIMIT_C,
    H_CEM_DEFAULT,
    PLACEMENT_MAX_C,
    STRIP_FRACTION,
)
from physics.equations import boundary
from physics.equations.diurnal import air_temp_series_c
from physics.equations.hydration import tau_hours, ultimate_degree, ultimate_heat_j_per_kg
from physics.equations.solar import (
    daylength_h,
    declination_deg,
    hourly_ghi_w_m2,
    sunrise_h,
    sunset_hour_angle_deg,
)
from physics.limits import EVAP_LIMIT_KG_M2_H
from physics.solver import solve
from physics.strength_model import params_for, strength_fraction
from physics.types import Ambient, Element, Mix, SolveResult
from physics.uncertainty import pool_context

# ---------------------------------------------------------------------------
# THE STANDARD ELEMENT - FIXED 2026-08-22, DO NOT TUNE
# ---------------------------------------------------------------------------
# 300 mm slab, top exposed, soffit plywood-formed. The slab shape tags its side faces
# as symmetry planes, so the 3000 mm width is a presentation choice only: the solution
# is one-dimensional through the thickness and the width cannot change the answer.
STANDARD_ELEMENT = Element(
    shape="slab",
    dims_mm={"width": 3000.0, "thickness": 300.0},
    dx_m=0.01,
    placement_temp_c=20.0,   # overridden per day, see PLACEMENT_ABOVE_AMBIENT_C
    formwork="plywood_18mm",
    on_ground=False,         # suspended: the soffit is formed, not earth-backed
)

STANDARD_GRADE = "4000psi"

# 400 kg/m3 cementitious, w/cm 0.45, 20% fly ash. Class F ash assumed at 6% CaO, and an
# ordinary Type I/II clinker for the Schindler-Folliard tau regression.
CEMENTITIOUS_KG_M3 = 400.0
W_CM = 0.45
P_FLY_ASH = 0.20
P_FLY_ASH_CAO = 0.06
P_C3A, P_C3S, P_SO3 = 0.08, 0.55, 0.03
BLAINE_M2_KG = 380.0


# the standard mix, derived from the stated design rather than hardcoded as numbers,
# so the assumptions above stay visible instead of collapsing into three magic floats.
def standard_mix() -> Mix:
    return Mix(
        cementitious_kg_m3=CEMENTITIOUS_KG_M3,
        h_u_j_per_kg=ultimate_heat_j_per_kg(
            h_cem_j_per_g=H_CEM_DEFAULT,
            p_cem=1.0 - P_FLY_ASH,
            p_fa=P_FLY_ASH,
            p_fa_cao=P_FLY_ASH_CAO,
        ),
        h_cem_j_per_g=H_CEM_DEFAULT,
        alpha_u=ultimate_degree(W_CM, p_fa=P_FLY_ASH),
        tau_h=tau_hours(
            p_c3a=P_C3A,
            p_c3s=P_C3S,
            blaine_m2_kg=BLAINE_M2_KG,
            p_so3=P_SO3,
            p_fa=P_FLY_ASH,
            p_fa_cao=P_FLY_ASH_CAO,
        ),
        beta=BETA_DEFAULT,
    )


# ---------------------------------------------------------------------------
# Assumptions the temperature archive cannot supply
# ---------------------------------------------------------------------------
# A filter_type=3 heatmap carries daily min/mean/max AIR TEMPERATURE and nothing else.
# Humidity, wind, sky cover and irradiance are not measured, so they are held at fixed
# season-typical values. They are parameters, not constants, and they are echoed back in
# the result under "assumptions" so no reader can mistake them for observations.
DEFAULT_RH_FRAC = 0.20            # Phoenix summer afternoon, low
DEFAULT_WIND_MS = 2.5
DEFAULT_CLOUD_PCT = 10.0
DEFAULT_GHI_DAYLIGHT_W_M2 = 650.0  # clear-sky daylight mean, low-latitude summer

# Fresh concrete arrives warmer than the air: cement, mixing and truck heat. Applied to
# the air temperature at the placement hour to get the placement temperature, which is
# what the ACI 305 check tests. Without it that check could never fire.
PLACEMENT_ABOVE_AMBIENT_C = 3.0

SIM_HOURS = 72.0


@dataclass(frozen=True)
class DayWeather:
    """One cached day. Exactly what a filter_type=3 heatmap yields per tile."""

    date: str
    day_of_year: int
    t_min_c: float
    t_mean_c: float
    t_max_c: float


@dataclass(frozen=True)
class DayOutcome:
    """One day, one placement hour, one deterministic solve."""

    date: str
    placement_hour: int
    placement_temp_c: float
    peak_core_temp_c: float
    peak_core_time_h: float
    max_core_surface_diff_c: float
    max_anywhere_surface_diff_c: float
    # the same two measured against the surface SENSOR rather than the free surface.
    # The cracking count is taken from these; see season_exposure.
    max_core_probe_diff_c: float
    max_anywhere_probe_diff_c: float
    max_core_temp_anywhere_c: float
    peak_evaporation_kg_m2_h: float
    strip_time_h: float


# json rows from the cache in, typed days out. missing key is a crash, never a default.
def to_days(cached_season: Sequence[Mapping[str, Any]]) -> list[DayWeather]:
    return [
        DayWeather(
            date=str(row["date"]),
            day_of_year=int(row["day_of_year"]),
            t_min_c=float(row["t_min_c"]),
            t_mean_c=float(row["t_mean_c"]),
            t_max_c=float(row["t_max_c"]),
        )
        for row in cached_season
    ]


# one day's hourly weather, starting at the placement hour. Parton-Logan for the air,
# clear-sky half-sine for the sun, everything else flat at its assumed value.
def build_ambient(
    day: DayWeather,
    lat_deg: float,
    placement_hour: int,
    hours: float = SIM_HOURS,
    rh_frac: float = DEFAULT_RH_FRAC,
    wind_ms: float = DEFAULT_WIND_MS,
    cloud_pct: float = DEFAULT_CLOUD_PCT,
    ghi_daylight_w_m2: float = DEFAULT_GHI_DAYLIGHT_W_M2,
) -> Ambient:
    n_hours = int(round(hours)) + 1
    air_temp_c = air_temp_series_c(
        day.t_min_c,
        day.t_mean_c,
        day.t_max_c,
        lat_deg,
        day.day_of_year,
        hours=n_hours,
        start_hour=float(placement_hour),
    )

    day_len = float(daylength_h(sunset_hour_angle_deg(lat_deg, declination_deg(day.day_of_year))))
    sunrise = float(sunrise_h(day_len))
    clock_hour = (np.arange(n_hours, dtype=np.float64) + placement_hour) % 24.0
    ghi_w_m2 = hourly_ghi_w_m2(ghi_daylight_w_m2, clock_hour, sunrise, day_len)

    ones = np.ones(n_hours, dtype=np.float64)
    return Ambient(
        hours=np.arange(n_hours, dtype=np.float64),
        air_temp_c=air_temp_c,
        rh_frac=ones * rh_frac,
        wind_ms=ones * wind_ms,
        cloud_pct=ones * cloud_pct,
        ghi_w_m2=ghi_w_m2,
    )


# surface evaporation over the recorded frames, kg/m2/s. the solver applies this
# internally as a latent flux but does not report it, so recompute on the frame cadence.
def evaporation_series_kg_m2_s(result: SolveResult, ambient: Ambient) -> FloatArray:
    def at(values: FloatArray) -> FloatArray:
        return np.asarray(np.interp(result.times_h, ambient.hours, values), dtype=np.float64)

    return boundary.evaporation_rate_kg_m2_s(
        result.surface_temp_c, at(ambient.air_temp_c), at(ambient.rh_frac), at(ambient.wind_ms)
    )


# first frame time where the weakest point in the section reaches the target fraction.
def deterministic_strip_time_h(
    result: SolveResult, grade: str = STANDARD_GRADE, target_fraction: float = STRIP_FRACTION
) -> float:
    weakest_t_e_h = np.nanmin(result.t_e_h_frames, axis=(1, 2))
    fraction = strength_fraction(weakest_t_e_h, params_for(grade))
    reached = np.nonzero(fraction >= target_fraction)[0]
    if reached.size == 0:
        return float("nan")
    return float(result.times_h[reached[0]])


# one deterministic day. top level so multiprocessing can pickle it.
def _run_day(job: tuple[DayWeather, int, Element, Mix, float, dict[str, Any]]) -> DayOutcome:
    day, placement_hour, element, mix, lat_deg, options = job
    ambient = build_ambient(day, lat_deg, placement_hour, **options)
    placement_temp_c = float(ambient.air_temp_c[0]) + PLACEMENT_ABOVE_AMBIENT_C

    placed = Element(
        shape=element.shape,
        dims_mm=element.dims_mm,
        dx_m=element.dx_m,
        placement_temp_c=placement_temp_c,
        formwork=element.formwork,
        on_ground=element.on_ground,
    )
    result = solve(placed, mix, ambient, dt_s=10.0, hours=SIM_HOURS)

    return DayOutcome(
        date=day.date,
        placement_hour=placement_hour,
        placement_temp_c=placement_temp_c,
        peak_core_temp_c=result.peak_core_temp_c,
        peak_core_time_h=result.peak_core_time_h,
        max_core_surface_diff_c=result.max_core_surface_diff_c,
        max_anywhere_surface_diff_c=result.max_anywhere_surface_diff_c,
        max_core_probe_diff_c=result.max_core_probe_diff_c,
        max_anywhere_probe_diff_c=result.max_anywhere_probe_diff_c,
        max_core_temp_anywhere_c=result.max_core_temp_anywhere_c,
        peak_evaporation_kg_m2_h=float(
            np.max(evaporation_series_kg_m2_s(result, ambient)) * 3600.0
        ),
        strip_time_h=deterministic_strip_time_h(result),
    )


# replay a whole season for one fixed element. returns breach statistics.
def season_exposure(
    cached_season: Sequence[Mapping[str, Any]],
    element: Element = STANDARD_ELEMENT,
    mix: Mix | None = None,
    placement_hours: tuple[int, ...] = (4, 14),
    lat_deg: float = 33.45,          # Phoenix
    def_limit_c: float | None = None,
    processes: int | None = None,
) -> dict[str, Any]:
    days = to_days(cached_season)
    if not days:
        raise ValueError("cached_season is empty - fetch the season before analysing it")

    mix = mix if mix is not None else standard_mix()
    # unconditional unless a caller passes a chemistry-derived limit in. The standard
    # mix states SO3 but not Al2O3, and guessing alumina to relax a DEF limit is
    # exactly the wrong direction to guess in.
    def_limit_c = def_limit_c if def_limit_c is not None else DEF_LIMIT_C

    jobs: list[tuple[DayWeather, int, Element, Mix, float, dict[str, Any]]] = [
        (day, hour, element, mix, lat_deg, {}) for hour in placement_hours for day in days
    ]
    if processes == 1:
        outcomes = [_run_day(job) for job in jobs]
    else:
        with pool_context().Pool(processes) as pool:
            outcomes = pool.map(_run_day, jobs)

    by_hour = {
        hour: [o for o in outcomes if o.placement_hour == hour] for hour in placement_hours
    }
    per_hour = {
        str(hour): _summarise(rows, def_limit_c) for hour, rows in by_hour.items() if rows
    }

    return {
        "n_days": len(days),
        "date_range": [days[0].date, days[-1].date],
        "sampling": _sampling(days),
        "placement_hours": list(placement_hours),
        "per_placement_hour": per_hour,
        "delta_14_minus_04": _delta(per_hour.get("14"), per_hour.get("4")),
        "element": {
            "fixed_on": "2026-08-22",
            "shape": element.shape,
            "dims_mm": element.dims_mm,
            "formwork": element.formwork,
            "on_ground": element.on_ground,
            "grade": STANDARD_GRADE,
            "cementitious_kg_m3": CEMENTITIOUS_KG_M3,
            "w_cm": W_CM,
            "fly_ash_fraction": P_FLY_ASH,
        },
        "limits": {
            "def_c": def_limit_c,
            "cracking_diff_c": CRACK_LIMIT_C,
            "evaporation_kg_m2_h": EVAP_LIMIT_KG_M2_H,
            "placement_c": PLACEMENT_MAX_C,
            "strip_fraction": STRIP_FRACTION,
        },
        "assumptions": {
            "rh_frac": DEFAULT_RH_FRAC,
            "wind_ms": DEFAULT_WIND_MS,
            "cloud_pct": DEFAULT_CLOUD_PCT,
            "ghi_daylight_w_m2": DEFAULT_GHI_DAYLIGHT_W_M2,
            "placement_above_ambient_c": PLACEMENT_ABOVE_AMBIENT_C,
            "note": (
                "Humidity, wind, cloud and irradiance are NOT measured. A filter_type=3 "
                "heatmap carries air temperature only. Hourly air temperature is a "
                "Parton-Logan reconstruction from daily min/mean/max, not an observed "
                "hourly series. Strip times use PROVISIONAL strength calibration."
            ),
        },
    }


# how the days were sampled out of the range they span.
#
# n_days and date_range cannot tell a strided sample from a full run: 30 days spanning
# 2025-06-03..2025-08-29 reads as a covered 30-day window unless something says the span
# is 88 days on a 3-day stride. A percentage computed off 30 non-consecutive summer days
# is a fine statistic; presenting it as a covered season is not.
def _sampling(days: list[DayWeather]) -> dict[str, Any]:
    first, last = date_type.fromisoformat(days[0].date), date_type.fromisoformat(days[-1].date)
    span_days = (last - first).days + 1
    gaps = {
        (date_type.fromisoformat(b.date) - date_type.fromisoformat(a.date)).days
        for a, b in zip(days, days[1:], strict=False)
    }
    return {
        "n_days": len(days),
        "span_days": span_days,
        "consecutive": len(days) == span_days,
        # None when the gaps are uneven - a single number would misdescribe them.
        "stride_days": gaps.pop() if len(gaps) == 1 else None,
        "coverage_pct": 100.0 * len(days) / span_days,
    }


# breach counts and strip-time centre for one placement hour.
def _summarise(rows: list[DayOutcome], def_limit_c: float) -> dict[str, Any]:
    n = len(rows)
    strip_times_h = [o.strip_time_h for o in rows if not np.isnan(o.strip_time_h)]

    def pct(flags: list[bool]) -> float:
        return 100.0 * sum(flags) / n

    return {
        "n_days": n,
        # hottest point in the section, not the nominal probe. DEF happens where it is
        # hottest, and on this element the two differ by about 4 C.
        "pct_days_breaching_def": pct(
            [o.max_core_temp_anywhere_c > def_limit_c for o in rows]
        ),
        # hottest point again, same reason as DEF above. The core-probe differential
        # reads about 4.5 C low, so counting days on it alone undercounts cracking.
        #
        # Measured against the surface SENSOR, not the free surface: CRACK_LIMIT_C comes
        # from ACI 301, which writes it against a thermocouple cast a few inches under a
        # face, and the free surface is colder than that reading.
        #
        # On the free surface this read 100% at BOTH placement hours, which is not a
        # season statistic - it is a flag that fires on everything. Against the sensor it
        # reads 0% at 04:00 and 50% at 14:00, which is the comparison this whole file
        # exists to make. The element here is a 300 mm slab, so 50 mm is a third of the
        # half-thickness and the reducer moves a long way; on a 2 m section it barely
        # moves at all. LIMITATIONS.md item 10 has the depth sweep and the caveat.
        "pct_days_breaching_cracking": pct(
            [
                max(o.max_core_probe_diff_c, o.max_anywhere_probe_diff_c) > CRACK_LIMIT_C
                for o in rows
            ]
        ),
        "pct_days_breaching_evaporation": pct(
            [o.peak_evaporation_kg_m2_h > EVAP_LIMIT_KG_M2_H for o in rows]
        ),
        "pct_days_breaching_placement": pct([o.placement_temp_c > PLACEMENT_MAX_C for o in rows]),
        "mean_peak_core_temp_c": mean(o.peak_core_temp_c for o in rows),
        "mean_max_core_temp_anywhere_c": mean(o.max_core_temp_anywhere_c for o in rows),
        "mean_strip_time_h": mean(strip_times_h) if strip_times_h else float("nan"),
        "median_strip_time_h": median(strip_times_h) if strip_times_h else float("nan"),
        "n_days_never_stripped": n - len(strip_times_h),
    }


# afternoon minus dawn. the headline: what moving the pour actually buys.
def _delta(hot: dict[str, Any] | None, cool: dict[str, Any] | None) -> dict[str, float] | None:
    if hot is None or cool is None:
        return None
    keys = (
        "pct_days_breaching_def",
        "pct_days_breaching_cracking",
        "pct_days_breaching_evaporation",
        "pct_days_breaching_placement",
        "mean_peak_core_temp_c",
        "mean_max_core_temp_anywhere_c",
        "mean_strip_time_h",
        "median_strip_time_h",
    )
    return {key: hot[key] - cool[key] for key in keys}
