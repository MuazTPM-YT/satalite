"""Load a case, run the solver against it, and report the error honestly.

The cases are transcribed by hand from tables in USBR DSO-12-02. Nothing here digitizes a
chart and nothing here is tuned: the mix parameters come out of the Schindler-Folliard
regressions exactly as the production code builds them, and the thresholds come out of
physics/constants.py. If a case fails, it fails in the report.

THE AMBIENT IS THE WEAK LINK. The reports give a multi-day average and maximum, not an
hourly series. We reconstruct a diurnal curve with Parton-Logan and infer the daily
minimum by reflecting the maximum about the mean. That is an assumption, it is stated in
every report this module writes, and it is the first thing to blame for a field-case miss.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from physics.equations.diurnal import air_temp_series_c
from physics.equations.hydration import tau_hours, ultimate_degree, ultimate_heat_j_per_kg
from physics.equations.solar import (
    daylength_h,
    declination_deg,
    hourly_ghi_w_m2,
    sunrise_h,
    sunset_hour_angle_deg,
)
from physics.solver import solve, uniform_ambient
from physics.types import Ambient, Element, Mix, SolveResult

CASES_DIR = Path(__file__).resolve().parent / "cases"

# Field cases ran in spring at moderate latitude with no reported sky data. These are
# assumptions, echoed into every report so they are never mistaken for measurements.
ASSUMED_RH_FRAC = 0.45
ASSUMED_WIND_MS = 2.0
ASSUMED_CLOUD_PCT = 40.0
ASSUMED_GHI_DAYLIGHT_W_M2 = 450.0

SIM_HOURS = 200.0    # past the 168 h checkpoint


@dataclass(frozen=True)
class CaseResult:
    """One case, run. Errors are predicted minus measured, so positive means we ran hot."""

    case_id: str
    name: str
    kind: str
    predicted: dict[str, Any]
    measured: dict[str, Any]
    errors: dict[str, Any]
    passed: dict[str, bool]
    notes: list[str]

    @property
    def all_passed(self) -> bool:
        return all(self.passed.values())


# every case on disk, in a stable order.
def load_cases(cases_dir: Path = CASES_DIR) -> list[dict[str, Any]]:
    return [yaml.safe_load(path.read_text()) for path in sorted(cases_dir.glob("*.yaml"))]


# case mix block in, physics Mix out. Built exactly as production builds one.
def build_mix(case: dict[str, Any]) -> Mix:
    mix = case["mix"]
    cementitious = float(mix["cementitious_kg_m3"])
    p_fa = float(mix["fly_ash_kg_m3"]) / cementitious
    p_cem = float(mix["cement_kg_m3"]) / cementitious
    p_fa_cao = float(mix["fly_ash_cao_frac"])

    from physics.constants import H_CEM_DEFAULT

    return Mix(
        cement_kg_m3=cementitious,
        h_u_j_per_kg=ultimate_heat_j_per_kg(
            h_cem_j_per_g=H_CEM_DEFAULT, p_cem=p_cem, p_fa=p_fa, p_fa_cao=p_fa_cao
        ),
        alpha_u=ultimate_degree(float(mix["w_cm"]), p_fa=p_fa),
        tau_h=tau_hours(
            p_c3a=float(mix["c3a_frac"]),
            p_c3s=float(mix["c3s_frac"]),
            blaine_m2_kg=float(mix["blaine_m2_kg"]),
            p_so3=float(mix["so3_frac"]),
            p_fa=p_fa,
            p_fa_cao=p_fa_cao,
        ),
    )


# case geometry block in, physics Element out.
def build_element(case: dict[str, Any]) -> Element:
    geometry = case["geometry"]
    return Element(
        shape=geometry["shape"],
        dims_mm={
            "thickness": float(geometry["thickness_mm"]),
            "height": float(geometry["height_mm"]),
        },
        dx_m=float(geometry["dx_m"]),
        placement_temp_c=float(case["initial"]["placement_temp_c"]),
        formwork=geometry["formwork"],
        on_ground=bool(geometry["on_ground"]),
    )


# reconstruct an hourly ambient from the reported average and maximum.
#
# Parton-Logan needs a daily minimum and none is reported, so we reflect the maximum about
# the mean: min = 2*mean - max. That forces a symmetric diurnal swing, which real weather
# is not. It is the single largest approximation in the field cases.
def build_ambient(case: dict[str, Any]) -> Ambient:
    ambient = case["ambient"]
    initial = case["initial"]
    mean_c, max_c = float(ambient["mean_c"]), float(ambient["max_c"])
    min_c = 2.0 * mean_c - max_c

    n_hours = int(SIM_HOURS) + 1
    placed_hour = int(initial["placed_hour"])
    lat_deg = float(initial["lat_deg"])
    day_of_year = int(initial["day_of_year"])

    air_temp_c = air_temp_series_c(
        min_c, mean_c, max_c, lat_deg, day_of_year, hours=n_hours, start_hour=float(placed_hour)
    )
    day_len = float(daylength_h(sunset_hour_angle_deg(lat_deg, declination_deg(day_of_year))))
    clock_hour = (np.arange(n_hours, dtype=np.float64) + placed_hour) % 24.0
    ghi_w_m2 = hourly_ghi_w_m2(
        ASSUMED_GHI_DAYLIGHT_W_M2, clock_hour, float(sunrise_h(day_len)), day_len
    )

    ones = np.ones(n_hours, dtype=np.float64)
    return Ambient(
        hours=np.arange(n_hours, dtype=np.float64),
        air_temp_c=air_temp_c,
        rh_frac=ones * ASSUMED_RH_FRAC,
        wind_ms=ones * ASSUMED_WIND_MS,
        cloud_pct=ones * ASSUMED_CLOUD_PCT,
        ghi_w_m2=ghi_w_m2,
    )


# the adiabatic case: no boundary conditions at all, so only the hydration chain is tested.
def run_adiabatic(case: dict[str, Any]) -> CaseResult:
    mix = build_mix(case)
    placement_temp_c = float(case["initial"]["placement_temp_c"])
    measured = case["measured"]
    tolerance_pct = float(case["acceptance"]["adiabatic_rise_pct"])

    # a sealed 1D block. adiabatic=True zeroes every face flux, so this is the closed form
    # the Mix already reports - solved anyway, so the solver itself is under test.
    element = Element(
        shape="wall",
        dims_mm={"thickness": 400.0, "height": 400.0},
        dx_m=0.02,
        placement_temp_c=placement_temp_c,
    )
    result = solve(
        element,
        mix,
        uniform_ambient(placement_temp_c, SIM_HOURS),
        hours=SIM_HOURS,
        adiabatic=True,
    )

    predicted_rise_c = result.peak_core_temp_c - placement_temp_c
    measured_rise_c = float(measured["adiabatic_rise_c"])
    error_pct = 100.0 * (predicted_rise_c - measured_rise_c) / measured_rise_c

    return CaseResult(
        case_id=case["id"],
        name=case["name"],
        kind=case["kind"],
        predicted={
            "adiabatic_rise_c": predicted_rise_c,
            "peak_temp_c": result.peak_core_temp_c,
            "closed_form_rise_c": mix.adiabatic_rise_c,
            "alpha_u": mix.alpha_u,
            "h_u_j_per_kg": mix.h_u_j_per_kg,
            "tau_h": mix.tau_h,
        },
        measured={
            "adiabatic_rise_c": measured_rise_c,
            "peak_temp_c": float(measured["peak_temp_c"]),
        },
        errors={"adiabatic_rise_c": predicted_rise_c - measured_rise_c,
                "adiabatic_rise_pct": error_pct},
        passed={"adiabatic_rise": abs(error_pct) <= tolerance_pct},
        notes=list(case.get("notes", [])),
    )


# a field case: full boundary conditions, compared at the reported checkpoints.
def run_field(case: dict[str, Any]) -> CaseResult:
    mix = build_mix(case)
    element = build_element(case)
    ambient = build_ambient(case)
    result = solve(element, mix, ambient, hours=SIM_HOURS)

    measured = case["measured"]
    acceptance = case["acceptance"]
    checkpoints_h = [float(h) for h in measured["checkpoints_h"]]
    measured_c = [float(t) for t in measured["core_temp_c"]]
    predicted_c = _at_times(result, checkpoints_h)

    checkpoint_errors_c = [p - m for p, m in zip(predicted_c, measured_c, strict=True)]
    peak_error_c = result.peak_core_temp_c - float(measured["peak_core_temp_c"])

    passed = {
        "peak_core_temp": abs(peak_error_c) <= float(acceptance["peak_core_temp_c"]),
        "checkpoints": max(abs(e) for e in checkpoint_errors_c)
        <= float(acceptance["checkpoint_temp_c"]),
    }

    window = measured.get("peak_time_window_h")
    peak_time_error_h: float | None = None
    if window:
        low, high = float(window[0]), float(window[1])
        centre_h = 0.5 * (low + high)
        peak_time_error_h = result.peak_core_time_h - centre_h
        passed["peak_time"] = (
            abs(peak_time_error_h) <= float(acceptance["peak_time_h"])
            or low <= result.peak_core_time_h <= high
        )

    return CaseResult(
        case_id=case["id"],
        name=case["name"],
        kind=case["kind"],
        predicted={
            "checkpoints_h": checkpoints_h,
            "core_temp_c": predicted_c,
            "peak_core_temp_c": result.peak_core_temp_c,
            "peak_core_time_h": result.peak_core_time_h,
            "max_core_surface_diff_c": result.max_core_surface_diff_c,
            "alpha_u": mix.alpha_u,
            "h_u_j_per_kg": mix.h_u_j_per_kg,
            "tau_h": mix.tau_h,
            "closed_form_adiabatic_rise_c": mix.adiabatic_rise_c,
        },
        measured={
            "checkpoints_h": checkpoints_h,
            "core_temp_c": measured_c,
            "peak_core_temp_c": float(measured["peak_core_temp_c"]),
            "peak_time_window_h": window,
            "max_core_surface_diff_c": measured.get("max_core_surface_diff_c"),
        },
        errors={
            "checkpoint_c": checkpoint_errors_c,
            "peak_core_temp_c": peak_error_c,
            "peak_core_time_h": peak_time_error_h,
        },
        passed=passed,
        notes=list(case.get("notes", [])),
    )


# core temperature at arbitrary times, interpolated onto the recorded frames.
def _at_times(result: SolveResult, times_h: list[float]) -> list[float]:
    return [float(v) for v in np.interp(times_h, result.times_h, result.core_temp_c)]


# one case, dispatched on its kind.
def run_case(case: dict[str, Any]) -> CaseResult:
    if case["kind"] == "adiabatic":
        return run_adiabatic(case)
    return run_field(case)


# every case, in order. failures included - that is the point.
def run_all(cases_dir: Path = CASES_DIR) -> list[CaseResult]:
    return [run_case(case) for case in load_cases(cases_dir)]
