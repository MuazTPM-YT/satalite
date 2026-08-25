"""Load a case, run a 300-sample ensemble against it, and report coverage honestly.

The cases are transcribed by hand from tables in USBR DSO-12-02. Nothing here is tuned:
the mix parameters come out of the Schindler-Folliard regressions exactly as the
production code builds them, and the thresholds come out of physics/constants.py.

WHY COVERAGE AND NOT POINT ERROR. DSO-12-02 never publishes C3A, C3S, SO3 or Blaine for
either cement. A point prediction needs all four, so a point prediction against these
cases is a test of four numbers nobody measured. The Schindler-Folliard tau regression is
brutally sensitive to them - tau moves from 25.8 h to 15.2 h across a plausible SO3 range
alone, and tau sets the whole early-age shape. So the honest question is not "did one
guessed chemistry hit the thermocouple" but "does the published range of chemistries for
this cement type contain what actually happened". That is coverage: the fraction of
measured checkpoints landing inside the p05-p95 band.

Point error is still computed and still reported, on the ensemble median. It is a
SECONDARY metric. It is kept because a band can be right for the wrong reason, and a
median that is 15 C off while the band still covers is worth seeing.

A WIDE BAND IS NOT A RESULT. A band wide enough to contain anything proves nothing, so
every case reports its p95-p05 width at the peak and the report flags any case whose peak
band exceeds BAND_WIDTH_WARN_C.

THE AMBIENT IS STILL THE WEAK LINK. The reports give a multi-day average and maximum, not
an hourly series. We reconstruct a diurnal curve with Parton-Logan and infer the daily
minimum by reflecting the maximum about the mean. That assumption is NOT inside the band:
the ensemble varies the mix and the surface, not the weather reconstruction. Coverage is
therefore conditional on the reconstructed ambient, and it is the first thing to blame for
a case that misses.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from physics.constants import H_CEM_BY_TYPE, H_CEM_DEFAULT
from physics.equations.diurnal import air_temp_series_c
from physics.equations.hydration import tau_hours, ultimate_degree, ultimate_heat_j_per_kg
from physics.equations.solar import (
    daylength_h,
    declination_deg,
    hourly_ghi_w_m2,
    sunrise_h,
    sunset_hour_angle_deg,
)
from physics.solver import uniform_ambient
from physics.types import Ambient, Element, Mix
from physics.uncertainty import Ensemble, run_ensemble

CASES_DIR = Path(__file__).resolve().parent / "cases"

# Field cases ran in spring at moderate latitude with no reported sky data. These are
# assumptions, echoed into every report so they are never mistaken for measurements.
ASSUMED_RH_FRAC = 0.45
ASSUMED_WIND_MS = 2.0
ASSUMED_CLOUD_PCT = 40.0
ASSUMED_GHI_DAYLIGHT_W_M2 = 450.0

SIM_HOURS = 200.0    # past the 168 h checkpoint

N_SAMPLES = 300
SEED = 0
ENSEMBLE_DX_M = 0.02

# Coverage at or above this passes. Chosen to match the nominal 90% width of a p05-p95
# band: if the sampled ranges really do bracket the truth, that is what should land.
COVERAGE_PASS_PCT = 90.0

# A peak band wider than this is reported as uninformative regardless of its coverage.
BAND_WIDTH_WARN_C = 25.0

# ---------------------------------------------------------------------------
# ASSUMED CHEMISTRY RANGES - NOT MEASURED VALUES
# ---------------------------------------------------------------------------
# DSO-12-02 states the ASTM C150 cement type and nothing else about the clinker. These
# are typical published ASTM C150 composition ranges for each type. They are ASSUMPTIONS.
# They were written down from the type designation alone and MUST NOT be narrowed,
# shifted or re-centred to make a case pass - doing so would turn the validation into a
# curve fit against the very data it is supposed to test.
ASSUMED_CHEMISTRY_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "II": {
        "c3a_frac": (0.05, 0.08),
        "c3s_frac": (0.50, 0.60),
        "so3_frac": (0.025, 0.035),
        "blaine_m2_kg": (340.0, 400.0),
    },
    "II/V": {
        "c3a_frac": (0.03, 0.05),
        "c3s_frac": (0.50, 0.60),
        "so3_frac": (0.020, 0.030),
        "blaine_m2_kg": (330.0, 390.0),
    },
}


@dataclass(frozen=True)
class CaseResult:
    """One case, run as an ensemble.

    Coverage is primary. Errors are median-predicted minus measured, so positive means
    the ensemble median ran hot.
    """

    case_id: str
    name: str
    kind: str
    cement_type: str
    coverage: dict[str, Any]
    bands: dict[str, Any]
    predicted: dict[str, Any]
    measured: dict[str, Any]
    errors: dict[str, Any]
    passed: dict[str, bool]
    chemistry_ranges: dict[str, tuple[float, float]]
    notes: list[str]

    @property
    def all_passed(self) -> bool:
        return all(self.passed.values())

    # a band this wide contains anything, so it is not evidence even when it covers.
    @property
    def band_too_wide(self) -> bool:
        return bool(self.bands["peak_width_c"] > BAND_WIDTH_WARN_C)


# every case on disk, in a stable order.
def load_cases(cases_dir: Path = CASES_DIR) -> list[dict[str, Any]]:
    return [yaml.safe_load(path.read_text()) for path in sorted(cases_dir.glob("*.yaml"))]


# the cement type a case states, and the ranges that go with it.
def chemistry_ranges(case: dict[str, Any]) -> tuple[str, dict[str, tuple[float, float]]]:
    cement_type = str(case["mix"]["cement_type"])
    if cement_type not in ASSUMED_CHEMISTRY_RANGES:
        raise KeyError(
            f"{case['id']} states cement_type {cement_type!r}, which has no published "
            f"range in ASSUMED_CHEMISTRY_RANGES ({sorted(ASSUMED_CHEMISTRY_RANGES)})"
        )
    return cement_type, ASSUMED_CHEMISTRY_RANGES[cement_type]


# n draws of tau, one per ensemble member, from the ASSUMED chemistry ranges.
#
# Uniform over each range and independent between them. Independence overstates the
# spread slightly - real clinkers correlate C3A with C3S - but the alternative is
# inventing a covariance nobody published, and a slightly wide band is the honest error
# to make here. The draws use their own generator so the ensemble's own stream, and
# therefore every other sampled parameter, is untouched.
def draw_tau_h(case: dict[str, Any], n: int, seed: int) -> tuple[list[float], dict[str, Any]]:
    _, ranges = chemistry_ranges(case)
    mix = case["mix"]
    cementitious = float(mix["cementitious_kg_m3"])
    p_fa = float(mix["fly_ash_kg_m3"]) / cementitious
    p_fa_cao = float(mix["fly_ash_cao_frac"])

    rng = np.random.default_rng(seed)
    drawn = {
        name: rng.uniform(low, high, n) for name, (low, high) in sorted(ranges.items())
    }
    tau_h = [
        tau_hours(
            p_c3a=float(drawn["c3a_frac"][i]),
            p_c3s=float(drawn["c3s_frac"][i]),
            blaine_m2_kg=float(drawn["blaine_m2_kg"][i]),
            p_so3=float(drawn["so3_frac"][i]),
            p_fa=p_fa,
            p_fa_cao=p_fa_cao,
        )
        for i in range(n)
    ]
    summary = {
        "tau_h_p05": float(np.percentile(tau_h, 5)),
        "tau_h_p50": float(np.percentile(tau_h, 50)),
        "tau_h_p95": float(np.percentile(tau_h, 95)),
    }
    return tau_h, summary


# case mix block in, physics Mix out. Built exactly as production builds one.
#
# tau_h here is the range MIDPOINT and is only a placeholder: the ensemble replaces it
# per sample with a chemistry-derived draw. H_cem comes from the stated ASTM type.
def build_mix(case: dict[str, Any]) -> Mix:
    mix = case["mix"]
    cementitious = float(mix["cementitious_kg_m3"])
    p_fa = float(mix["fly_ash_kg_m3"]) / cementitious
    p_cem = float(mix["cement_kg_m3"]) / cementitious
    p_fa_cao = float(mix["fly_ash_cao_frac"])
    cement_type = str(mix["cement_type"])
    h_cem = H_CEM_BY_TYPE.get(cement_type, H_CEM_DEFAULT)
    ranges = ASSUMED_CHEMISTRY_RANGES[cement_type]

    def midpoint(name: str) -> float:
        low, high = ranges[name]
        return 0.5 * (low + high)

    return Mix(
        cementitious_kg_m3=cementitious,
        h_u_j_per_kg=ultimate_heat_j_per_kg(
            h_cem_j_per_g=h_cem, p_cem=p_cem, p_fa=p_fa, p_fa_cao=p_fa_cao
        ),
        alpha_u=ultimate_degree(float(mix["w_cm"]), p_fa=p_fa),
        tau_h=tau_hours(
            p_c3a=midpoint("c3a_frac"),
            p_c3s=midpoint("c3s_frac"),
            blaine_m2_kg=midpoint("blaine_m2_kg"),
            p_so3=midpoint("so3_frac"),
            p_fa=p_fa,
            p_fa_cao=p_fa_cao,
        ),
        h_cem_j_per_g=h_cem,
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
# is not. It is the single largest approximation in the field cases, and it is NOT varied
# by the ensemble, so it sits outside the band rather than inside it.
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


# p05/p50/p95 of core temperature at arbitrary times, across the whole ensemble.
def _core_bands_at(ensemble: Ensemble, times_h: list[float]) -> dict[str, list[float]]:
    per_sample = np.asarray(
        [np.interp(times_h, ensemble.times_h, row) for row in ensemble.core_temp_c],
        dtype=np.float64,
    )
    p05, p50, p95 = np.percentile(per_sample, [5.0, 50.0, 95.0], axis=0)
    return {"p05": p05.tolist(), "p50": p50.tolist(), "p95": p95.tolist()}


# how many measured values land inside their band. THE primary metric.
def _coverage(measured: list[float], p05: list[float], p95: list[float]) -> dict[str, Any]:
    inside = [
        bool(low <= value <= high)
        for value, low, high in zip(measured, p05, p95, strict=True)
    ]
    return {
        "n_checkpoints": len(inside),
        "n_inside": sum(inside),
        "pct_inside": 100.0 * sum(inside) / len(inside),
        "inside": inside,
    }


# the adiabatic case: no boundary conditions at all, so only the hydration chain is tested.
def run_adiabatic(case: dict[str, Any]) -> CaseResult:
    mix = build_mix(case)
    cement_type, ranges = chemistry_ranges(case)
    placement_temp_c = float(case["initial"]["placement_temp_c"])
    measured = case["measured"]
    tau_h_samples, tau_summary = draw_tau_h(case, N_SAMPLES, SEED)

    # a sealed 1D block. adiabatic=True zeroes every face flux, so this is the closed form
    # the Mix already reports - solved anyway, so the solver itself is under test.
    element = Element(
        shape="wall",
        dims_mm={"thickness": 400.0, "height": 400.0},
        dx_m=ENSEMBLE_DX_M,
        placement_temp_c=placement_temp_c,
    )
    ensemble = run_ensemble(
        element,
        mix,
        uniform_ambient(placement_temp_c, SIM_HOURS),
        n=N_SAMPLES,
        seed=SEED,
        dx_m=ENSEMBLE_DX_M,
        hours=SIM_HOURS,
        adiabatic=True,
        tau_h_samples=tau_h_samples,
    )

    # rise is measured from each sample's OWN placement temperature, which the ensemble
    # perturbs. Subtracting the nominal instead would smear the placement spread into
    # the rise and inflate the band by about 6 C for free.
    placed_c = np.asarray(
        [placement_temp_c + s.placement_temp_offset_c for s in ensemble.samples],
        dtype=np.float64,
    )
    rise_c = ensemble.peak_core_temp_c() - placed_c
    p05, p50, p95 = (float(v) for v in np.percentile(rise_c, [5.0, 50.0, 95.0]))

    measured_rise_c = float(measured["adiabatic_rise_c"])
    coverage = _coverage([measured_rise_c], [p05], [p95])
    error_c = p50 - measured_rise_c

    return CaseResult(
        case_id=case["id"],
        name=case["name"],
        kind=case["kind"],
        cement_type=cement_type,
        coverage=coverage,
        bands={
            "quantity": "adiabatic_rise_c",
            "p05": [p05],
            "p50": [p50],
            "p95": [p95],
            "peak_width_c": p95 - p05,
        },
        predicted={
            "adiabatic_rise_c_p50": p50,
            "closed_form_rise_c": mix.adiabatic_rise_c,
            "alpha_u": mix.alpha_u,
            "h_u_j_per_kg": mix.h_u_j_per_kg,
            "h_cem_j_per_g": mix.h_cem_j_per_g,
            **tau_summary,
        },
        measured={
            "adiabatic_rise_c": measured_rise_c,
            "peak_temp_c": float(measured["peak_temp_c"]),
        },
        errors={
            "adiabatic_rise_c": error_c,
            "adiabatic_rise_pct": 100.0 * error_c / measured_rise_c,
        },
        passed={"coverage": coverage["pct_inside"] >= COVERAGE_PASS_PCT},
        chemistry_ranges=ranges,
        notes=list(case.get("notes", [])),
    )


# a field case: full boundary conditions, compared at the reported checkpoints.
def run_field(case: dict[str, Any]) -> CaseResult:
    mix = build_mix(case)
    cement_type, ranges = chemistry_ranges(case)
    tau_h_samples, tau_summary = draw_tau_h(case, N_SAMPLES, SEED)

    ensemble = run_ensemble(
        build_element(case),
        mix,
        build_ambient(case),
        n=N_SAMPLES,
        seed=SEED,
        dx_m=ENSEMBLE_DX_M,
        hours=SIM_HOURS,
        tau_h_samples=tau_h_samples,
    )

    measured = case["measured"]
    checkpoints_h = [float(h) for h in measured["checkpoints_h"]]
    measured_c = [float(t) for t in measured["core_temp_c"]]
    bands = _core_bands_at(ensemble, checkpoints_h)
    coverage = _coverage(measured_c, bands["p05"], bands["p95"])

    peaks_c = ensemble.peak_core_temp_c()
    peak_p05, peak_p50, peak_p95 = (float(v) for v in np.percentile(peaks_c, [5.0, 50.0, 95.0]))
    measured_peak_c = float(measured["peak_core_temp_c"])

    checkpoint_errors_c = [p - m for p, m in zip(bands["p50"], measured_c, strict=True)]

    return CaseResult(
        case_id=case["id"],
        name=case["name"],
        kind=case["kind"],
        cement_type=cement_type,
        coverage=coverage,
        bands={
            "quantity": "core_temp_c",
            "checkpoints_h": checkpoints_h,
            **bands,
            "peak_p05": peak_p05,
            "peak_p50": peak_p50,
            "peak_p95": peak_p95,
            "peak_width_c": peak_p95 - peak_p05,
            "peak_covered": bool(peak_p05 <= measured_peak_c <= peak_p95),
        },
        predicted={
            "checkpoints_h": checkpoints_h,
            "core_temp_c_p50": bands["p50"],
            "peak_core_temp_c_p50": peak_p50,
            "alpha_u": mix.alpha_u,
            "h_u_j_per_kg": mix.h_u_j_per_kg,
            "h_cem_j_per_g": mix.h_cem_j_per_g,
            **tau_summary,
        },
        measured={
            "checkpoints_h": checkpoints_h,
            "core_temp_c": measured_c,
            "peak_core_temp_c": measured_peak_c,
            "peak_time_window_h": measured.get("peak_time_window_h"),
            "max_core_surface_diff_c": measured.get("max_core_surface_diff_c"),
        },
        errors={
            "checkpoint_c": checkpoint_errors_c,
            "peak_core_temp_c": peak_p50 - measured_peak_c,
            "max_abs_checkpoint_c": max(abs(e) for e in checkpoint_errors_c),
        },
        passed={"coverage": coverage["pct_inside"] >= COVERAGE_PASS_PCT},
        chemistry_ranges=ranges,
        notes=list(case.get("notes", [])),
    )


# one case, dispatched on its kind.
def run_case(case: dict[str, Any]) -> CaseResult:
    if case["kind"] == "adiabatic":
        return run_adiabatic(case)
    return run_field(case)


# every case, in order. failures included - that is the point.
def run_all(cases_dir: Path = CASES_DIR) -> list[CaseResult]:
    return [run_case(case) for case in load_cases(cases_dir)]
