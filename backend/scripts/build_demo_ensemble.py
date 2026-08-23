"""TASK 6 - build the demo band offline so no request thread ever runs an ensemble.

Writes demo-ensemble.json into the cache directory, next to season-analysis.json.
/api/demo-ensemble reads it and never computes.

Run:  cd backend && .venv/bin/python -m scripts.build_demo_ensemble

Takes about six minutes. That is the point: offline, N is bounded by patience instead of
by a gateway timeout, so the band edges can be made quiet enough to be worth quoting.
Measured seed-to-seed noise on the p05/p95 of peak core temperature (5 seeds, scrambled
Sobol): 0.34 C at N=300, 0.27 C at N=600. N below is chosen to push that further down.
"""

import json
from datetime import UTC, datetime

import numpy as np

from app.config import get_settings
from app.models import (
    AmbientSpec,
    DemoEnsembleResponse,
    ElementSpec,
    MixSpec,
    SimulationRequest,
)
from app.services.simulate import run_bands, to_ambient, to_element, to_mix
from physics.season_analysis import (
    PLACEMENT_ABOVE_AMBIENT_C,
    SIM_HOURS,
    STANDARD_ELEMENT,
    STANDARD_GRADE,
    DayWeather,
    build_ambient,
)
from physics.uncertainty import SAMPLED_PARAMETERS

# THE DEMO SCENARIO. Fixed here, and it must stay fixed: the served band is only
# meaningful next to the pour it was computed for.
#
# Same standard element the season replay uses, same hot Phoenix day the efficiency
# measurements used. t_min/t_mean/t_max are STATED, not fetched - no season sits in the
# cache, so writing the day down beats pretending it was observed.
HOT_DAY = DayWeather(
    date="2025-07-15", day_of_year=196, t_min_c=30.0, t_mean_c=36.5, t_max_c=43.0
)
LAT_DEG = 33.45
PLACEMENT_HOUR = 14

# a power of two, so Sobol gets a complete balanced block. 2048 is also above the 2000
# cap the live route enforces, which is the split doing its job.
N_SAMPLES = 2048
SEED = 0

FILENAME = "demo-ensemble.json"

NOTE = (
    "Precomputed for the fixed scenario in this payload and for no other. The "
    "deterministic curve is solved live per request at dx = 10 mm; these bands were "
    "solved offline at dx = 20 mm, which moves peak core temperature by +0.03 C against "
    "that 10 mm curve - measured on this scenario, not estimated. The 0.7 C this note "
    "used to claim predates the q attenuation fix, when 20 mm really did cost 0.2-0.3 C "
    "and in the opposite direction. "
    "BAND EDGES CARRY SAMPLING NOISE, AND THE TWO EDGES ARE NOT EQUALLY QUIET. "
    "Seed-to-seed sd over 5 seeds, scrambled Sobol, measured on this scenario: p05 "
    "1.21 / 0.67 / 0.34 / 0.12 C and p95 0.41 / 0.61 / 0.36 / 0.32 C at N = "
    "64 / 128 / 300 / 600. NEITHER EDGE REACHES 0.1 C AT ANY N TESTED. The lower edge "
    "falls roughly as 1/sqrt(N); the upper edge improves only 12 percent over the last "
    "doubling, so it is not settling and no extrapolation to the N used here is "
    "trustworthy - the previous note extrapolated to 0.12-0.15 C and the N=600 "
    "measurement did not support it. Read the upper edge to about 0.3 C and the lower "
    "to about 0.15 C, not to the precision they are printed at. "
    "Air temperature is a Parton-Logan reconstruction from stated daily min/mean/max, "
    "not an observed hourly series. Strip times use PROVISIONAL strength calibration."
)


# the scenario, as the API's own request model. round-trips through the same validation
# a caller's POST would face, so a scenario that could not be requested cannot be served.
def scenario() -> SimulationRequest:
    ambient = build_ambient(HOT_DAY, LAT_DEG, PLACEMENT_HOUR, hours=SIM_HOURS)

    def series(values: np.ndarray) -> list[float]:
        return [float(v) for v in values]

    return SimulationRequest(
        element=ElementSpec(
            shape=STANDARD_ELEMENT.shape,
            dims_mm=dict(STANDARD_ELEMENT.dims_mm),
            dx_m=STANDARD_ELEMENT.dx_m,
            placement_temp_c=float(ambient.air_temp_c[0]) + PLACEMENT_ABOVE_AMBIENT_C,
            formwork=STANDARD_ELEMENT.formwork,
            on_ground=STANDARD_ELEMENT.on_ground,
        ),
        mix=MixSpec(grade=STANDARD_GRADE),
        ambient=AmbientSpec(
            hours_h=series(ambient.hours),
            air_temp_c=series(ambient.air_temp_c),
            rh_frac=series(ambient.rh_frac),
            wind_ms=series(ambient.wind_ms),
            cloud_pct=series(ambient.cloud_pct),
            ghi_w_m2=series(ambient.ghi_w_m2),
            sky_offset_c=ambient.sky_offset_c,
        ),
        duration_hours=SIM_HOURS,
    )


def main() -> None:
    request = scenario()
    print(f"building {N_SAMPLES} samples, seed {SEED}, "
          f"placement {request.element.placement_temp_c:.1f} C ...")

    ensemble = run_bands(
        to_element(request.element),
        to_mix(request.mix),
        to_ambient(request.ambient),
        request.duration_hours,
        request.mix.grade,
        N_SAMPLES,
        SEED,
    )

    payload = DemoEnsembleResponse(
        scenario=request,
        ensemble=ensemble,
        built_at=datetime.now(UTC).isoformat(timespec="seconds"),
        sampler="scipy.stats.qmc.Sobol(scramble=True)",
        dt_s=30.0,  # mirrors run_ensemble's default. change both or neither.
        sampled_parameters=list(SAMPLED_PARAMETERS),
        note=NOTE,
    )

    path = get_settings().cache_dir / FILENAME
    path.write_text(json.dumps(json.loads(payload.model_dump_json()), indent=2))
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} kB)")


# non-fork start method re-imports this module in every worker of the ensemble pool.
if __name__ == "__main__":
    main()
