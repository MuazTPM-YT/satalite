"""The surface sensor: where it sits, and that the cracking flag reads it.

ACI 301's 35 degF core-to-surface limit is written against a thermocouple cast a few
inches under a face, not against the free surface. These check that the probe lands where
it claims to and that the flag is evaluated on it.
"""

import numpy as np

from app.models import ElementSpec, MixSpec
from app.services.simulate import run_deterministic, to_breaches, to_element, to_mix
from physics.geometry import rasterize
from physics.solver import uniform_ambient


# a probe at zero depth IS the face cell. anything else means the step is off by one.
def test_zero_depth_probe_is_the_boundary_cell() -> None:
    section = rasterize("slab", {"width": 1000.0, "thickness": 300.0}, 0.01, False)
    rows, cols = section.surface_probe_cells(0.0)
    top_rows, _ = np.nonzero(section.mask)
    assert rows.size > 0
    # a slab's only EXPOSED face is the top, so every probe cell is on the top row
    assert set(rows.tolist()) == {int(top_rows.max())}


# the whole point: depth_m metres in from the face, counted in cells.
def test_probe_steps_the_stated_depth_inward() -> None:
    dx = 0.01
    section = rasterize("slab", {"width": 1000.0, "thickness": 300.0}, dx, False)
    top = int(np.nonzero(section.mask)[0].max())
    for depth_m in (0.02, 0.05, 0.10):
        rows, _ = section.surface_probe_cells(depth_m)
        expected = top - int(round(depth_m / dx))
        assert set(rows.tolist()) == {expected}, depth_m


# a section thinner than the probe depth must not read a cell with no concrete in it.
def test_probe_never_leaves_the_mask_on_a_thin_section() -> None:
    section = rasterize("slab", {"width": 1000.0, "thickness": 60.0}, 0.01, False)
    rows, cols = section.surface_probe_cells(0.20)
    assert rows.size > 0
    assert bool(section.mask[rows, cols].all())


# the sensor reads warmer than the free surface while the element is losing heat, so the
# differential it sees is the smaller one. This is the entire reason the flag moved.
def test_sensor_differential_is_below_the_free_surface_differential() -> None:
    element = to_element(
        ElementSpec(
            shape="slab", dims_mm={"width": 3000.0, "thickness": 300.0},
            dx_m=0.02, placement_temp_c=30.0,
        )
    )
    mix = to_mix(MixSpec(mix_id="standard"))
    # no sun: the free surface then only ever runs colder than the concrete behind it,
    # which is the condition the ACI limit is written for.
    ambient = uniform_ambient(10.0, 48.0, wind_ms=3.0)
    result, payload = run_deterministic(element, mix, ambient, 48.0, "4000psi")

    assert result.max_core_probe_diff_c < result.max_core_surface_diff_c
    assert result.max_anywhere_probe_diff_c < result.max_anywhere_surface_diff_c
    assert result.surface_probe_depth_m == 0.050
    assert payload.surface_probe_depth_m == 0.050
    assert len(payload.surface_probe_temp_c) == len(payload.surface_temp_c)


# a deeper sensor sits closer to the core, so it reads a smaller differential.
def test_deeper_probe_reads_a_smaller_differential() -> None:
    mix = to_mix(MixSpec(mix_id="standard"))
    ambient = uniform_ambient(10.0, 48.0, wind_ms=3.0)

    def diff(depth_m: float) -> float:
        element = to_element(
            ElementSpec(
                shape="slab", dims_mm={"width": 3000.0, "thickness": 300.0},
                dx_m=0.02, placement_temp_c=30.0, surface_probe_depth_m=depth_m,
            )
        )
        return run_deterministic(element, mix, ambient, 48.0, "4000psi")[0].max_core_probe_diff_c

    assert diff(0.10) < diff(0.05) < diff(0.0)


# the flag has to read the sensor pair. Passing the free-surface pair is the defect this
# whole change exists to remove, and positionally the two are indistinguishable.
def test_cracking_flag_is_evaluated_on_the_sensor_differential() -> None:
    # sensor differential under the limit, free surface differential far over it
    flags = to_breaches(
        50.0, 50.0,
        max_diff_c=10.0, max_anywhere_diff_c=10.0,
        peak_evap_kg_m2_h=0.1, placement_temp_c=20.0,
    )
    assert not flags.cracking

    flags_over = to_breaches(
        50.0, 50.0,
        max_diff_c=10.0, max_anywhere_diff_c=25.0,
        peak_evap_kg_m2_h=0.1, placement_temp_c=20.0,
    )
    assert flags_over.cracking
    assert flags_over.cracking_tripped_by == "max_anywhere"
