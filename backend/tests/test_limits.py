"""Threshold checks, and the one gate that is deliberately still stubbed."""

import numpy as np
import pytest
from pydantic import ValidationError

from app.models import MixSpec
from app.services.simulate import h_cem_for, to_mix
from physics.constants import (
    CRACK_LIMIT_C,
    DEF_LIMIT_C,
    H_CEM_BY_TYPE,
    H_CEM_DEFAULT,
)
from physics.forecast_error import empirical_forecast_error
from physics.limits import (
    DEF_ETTRINGITE_C,
    EVAP_LIMIT_KG_M2_H,
    breaches_cracking,
    breaches_def,
    breaches_evaporation,
    breaches_placement,
    def_threshold_c,
)


# the USBR DSO-12-02 values that retired the PROVISIONALs
def test_constants_match_the_validation_data() -> None:
    assert DEF_LIMIT_C == 68.3        # 155 degF
    assert CRACK_LIMIT_C == 19.4      # 35 degF
    assert H_CEM_DEFAULT == 500.0     # J/g


# C3A carries the largest Bogue coefficient (866 J/g) and Type V is low-C3A by
# definition, so cement heat must fall monotonically as the type gets more sulfate
# resistant. Getting this order backwards would make the safest cement the hottest.
def test_cement_heat_falls_as_c3a_falls() -> None:
    assert H_CEM_BY_TYPE["I"] > H_CEM_BY_TYPE["II"] > H_CEM_BY_TYPE["II/V"] > H_CEM_BY_TYPE["V"]
    assert H_CEM_BY_TYPE["II"] == H_CEM_DEFAULT   # the fallback is the confirmed type


# an unknown type must not silently become the coolest one
def test_unknown_cement_type_falls_back_to_default() -> None:
    assert h_cem_for(None) == H_CEM_DEFAULT
    assert h_cem_for("V") == 450.0


def test_cement_type_moves_the_mix_heat() -> None:
    hot = to_mix(MixSpec(cement_type="I"))
    cool = to_mix(MixSpec(cement_type="V"))
    assert hot.h_u_j_per_kg > cool.h_u_j_per_kg
    assert hot.adiabatic_rise_c > cool.adiabatic_rise_c
    # and the mix remembers which mean the ensemble must perturb it about
    assert cool.h_cem_j_per_g == 450.0


def test_unknown_cement_type_is_rejected_at_the_boundary() -> None:
    with pytest.raises(ValidationError, match="unknown cement_type"):
        MixSpec(cement_type="IV")


# Heinz & Ludwig via DSO-12-02: below BOTH ratios a cement resists DEF, so the ceiling
# becomes the 158 degF ettringite threshold rather than the 155 degF design maximum.
def test_def_threshold_relaxes_only_for_resistant_chemistry() -> None:
    # SO3 3%, Al2O3 5%: S/A = 0.60 < 0.7 and S2/A = 0.018 < 0.020. Both met.
    assert def_threshold_c(0.03, 0.05) == DEF_ETTRINGITE_C
    # SO3 4%: S/A = 0.80 and S2/A = 0.032. Neither met.
    assert def_threshold_c(0.04, 0.05) == DEF_LIMIT_C
    # S/A alone is not enough - S2/A must also clear
    assert def_threshold_c(0.033, 0.05) == DEF_LIMIT_C


# a ratio is unit-invariant, so percent inputs must be rejected, not silently misread
def test_def_threshold_rejects_percent_inputs() -> None:
    with pytest.raises(ValueError, match="mass fractions"):
        def_threshold_c(3.0, 5.0)


# relaxing a safety limit needs real chemistry. the default path must not do it.
def test_api_breach_check_uses_the_unconditional_limit() -> None:
    from app.services.simulate import to_breaches

    assert to_breaches(50.0, 50.0, 5.0, 5.0, 0.1, 20.0).def_threshold_c == DEF_LIMIT_C


# def_risk trips on the hottest point in the section, not only on the nominal probe.
def test_def_risk_trips_on_the_hottest_point_not_only_the_probe() -> None:
    from app.services.simulate import to_breaches

    cool_probe = to_breaches(DEF_LIMIT_C - 4.0, DEF_LIMIT_C + 0.1, 5.0, 5.0, 0.1, 20.0)
    assert cool_probe.def_risk
    assert cool_probe.def_tripped_by == "max_anywhere"

    neither = to_breaches(DEF_LIMIT_C - 4.0, DEF_LIMIT_C, 5.0, 5.0, 0.1, 20.0)
    assert not neither.def_risk
    assert neither.def_tripped_by == "none"


# cracking gets the same treatment as def_risk. Two adjacent threshold flags evaluated on
# inconsistent definitions is the whole point of this pair of tests.
def test_cracking_trips_on_the_hottest_point_not_only_the_probe() -> None:
    from app.services.simulate import to_breaches

    cool_probe = to_breaches(
        50.0, 50.0, CRACK_LIMIT_C - 4.0, CRACK_LIMIT_C + 0.1, 0.1, 20.0
    )
    assert cool_probe.cracking
    assert cool_probe.cracking_tripped_by == "max_anywhere"

    neither = to_breaches(50.0, 50.0, CRACK_LIMIT_C - 4.0, CRACK_LIMIT_C, 0.1, 20.0)
    assert not neither.cracking
    assert neither.cracking_tripped_by == "none"

    both = to_breaches(
        50.0, 50.0, CRACK_LIMIT_C + 0.1, CRACK_LIMIT_C + 4.0, 0.1, 20.0
    )
    assert both.cracking
    assert both.cracking_tripped_by == "both"


def test_breach_predicates_use_strict_comparison() -> None:
    assert not breaches_def(DEF_LIMIT_C)
    assert breaches_def(DEF_LIMIT_C + 0.1)
    assert not breaches_cracking(CRACK_LIMIT_C)
    assert breaches_cracking(CRACK_LIMIT_C + 0.1)
    assert breaches_placement(33.0)
    assert not breaches_placement(31.0)


# the evaporation limit is quoted per hour, the solver works per second. trap 5 again.
def test_evaporation_limit_converts_hours_to_seconds() -> None:
    at_limit_kg_m2_s = EVAP_LIMIT_KG_M2_H / 3600.0
    assert not breaches_evaporation(at_limit_kg_m2_s)
    assert breaches_evaporation(at_limit_kg_m2_s * 1.01)


def test_breach_predicates_vectorise() -> None:
    flags = breaches_def(np.array([60.0, 70.0, 80.0]))
    assert flags.tolist() == [False, True, True]


# no paired data yet, so the documented default must come back marked PROVISIONAL
def test_forecast_error_default_is_marked_provisional() -> None:
    result = empirical_forecast_error([], [])
    assert result["provisional"] is True
    assert "PROVISIONAL" in result["source"]
    assert result["sigma_c"][0] == 0.5
    assert result["sigma_c"][-1] == 2.0
    assert np.all(np.diff(result["sigma_c"]) > 0.0), "sigma must widen with lead time"


def test_forecast_error_measures_real_pairs() -> None:
    forecasts = [
        {"tile_id": "t1", "valid_time": f"2025-06-{d:02d}T12", "lead_h": 6, "air_temp_c": 30.0 + d}
        for d in range(1, 6)
    ]
    observations = [
        {"tile_id": "t1", "valid_time": f"2025-06-{d:02d}T12", "air_temp_c": 29.0 + d}
        for d in range(1, 6)
    ]
    result = empirical_forecast_error(forecasts, observations)
    assert result["provisional"] is False
    assert result["bias_c"][5] == 1.0        # lead 6h is index 5
    assert result["sigma_c"][5] == 0.0       # a constant offset has no spread
    assert result["n_pairs"][5] == 5


# a forecast with no matching observation must be dropped, not scored against nothing
def test_unpaired_forecasts_fall_back_to_the_default() -> None:
    forecasts = [{"tile_id": "t1", "valid_time": "x", "lead_h": 3, "air_temp_c": 30.0}]
    observations = [{"tile_id": "OTHER", "valid_time": "x", "air_temp_c": 25.0}]
    assert empirical_forecast_error(forecasts, observations)["provisional"] is True
