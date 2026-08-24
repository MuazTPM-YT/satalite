"""Rasteriser and face tagging."""

import numpy as np
import pytest

from physics import geometry as g


# 300 mm at 10 mm cells is 30 cells, top open to the air, bottom on formwork
def test_slab_thickness_and_faces() -> None:
    s = g.rasterize("slab", {"thickness": 300.0, "width": 1000.0}, dx_m=0.01)
    assert s.mask.shape == (30, 100)
    assert s.mask.all()
    assert (s.face_tags[g.UP][-1] == g.EXPOSED).all()
    assert (s.face_tags[g.DOWN][0] == g.FORMED).all()
    # a slab strip is cut from a wider pour, so its sides are symmetry planes
    assert (s.face_tags[g.LEFT][:, 0] == g.ADIABATIC).all()
    assert (s.face_tags[g.RIGHT][:, -1] == g.ADIABATIC).all()
    # interior faces carry no boundary condition at all
    assert (s.face_tags[g.UP][:-1] == g.INTERIOR).all()


# ground contact only tags the true underside, never a soffit higher up
def test_ground_tag() -> None:
    s = g.rasterize("slab", {"thickness": 300.0, "width": 500.0}, dx_m=0.01, on_ground=True)
    assert (s.face_tags[g.DOWN][0] == g.GROUND).all()


# a column is formed on all four sides with only the top open
def test_column_is_formed_all_round() -> None:
    s = g.rasterize("rect_column", {"width": 400.0, "height": 400.0}, dx_m=0.01)
    assert s.mask.shape == (40, 40)
    assert (s.face_tags[g.LEFT][:, 0] == g.FORMED).all()
    assert (s.face_tags[g.RIGHT][:, -1] == g.FORMED).all()
    assert (s.face_tags[g.UP][-1] == g.EXPOSED).all()


# mask area must match the analytic area of each shape
@pytest.mark.parametrize(
    ("shape", "dims_mm", "expected_m2"),
    [
        ("slab", {"thickness": 300.0, "width": 1000.0}, 0.30),
        ("wall", {"thickness": 250.0, "height": 3000.0}, 0.75),
        ("beam", {"width": 300.0, "height": 600.0}, 0.18),
        ("circular_column", {"diameter": 600.0}, np.pi * 0.3**2),
        # T: flange 900x150 plus web 300x(750-150)
        ("t_section", {"flange_width": 900.0, "flange_thickness": 150.0,
                       "web_width": 300.0, "height": 750.0}, 0.9 * 0.15 + 0.3 * 0.6),
        # I: two 600x120 flanges plus the 180-wide web between them
        ("i_section", {"flange_width": 600.0, "flange_thickness": 120.0,
                       "web_width": 180.0, "height": 800.0},
         0.6 * 0.12 * 2 + 0.18 * (0.8 - 0.24)),
        # L: full 500x500 minus the missing 400x400 corner
        ("l_section", {"width": 500.0, "height": 500.0, "leg_thickness": 100.0},
         0.5 * 0.5 - 0.4 * 0.4),
    ],
)
def test_mask_area_matches_analytic(shape: str, dims_mm: dict[str, float],
                                    expected_m2: float) -> None:
    s = g.rasterize(shape, dims_mm, dx_m=0.01)
    assert s.area_m2 == pytest.approx(expected_m2, rel=0.02)


# the outline the frontend extrudes is the exact polygon the mask was cut from
def test_outline_is_the_rasteriser_input() -> None:
    dims = {"flange_width": 900.0, "flange_thickness": 150.0, "web_width": 300.0,
            "height": 750.0}
    s = g.rasterize("t_section", dims, dx_m=0.01)
    assert s.outline_m == g.outline("t_section", dims)
    assert len(s.outline_m) == 8
    assert all(len(p) == 2 for p in s.outline_m)


# a T-section has a soffit under each flange overhang. formed, not exposed, not ground.
def test_t_section_soffits_are_formed() -> None:
    s = g.rasterize(
        "t_section",
        {"flange_width": 900.0, "flange_thickness": 150.0, "web_width": 300.0, "height": 750.0},
        dx_m=0.01,
    )
    down = s.face_tags[g.DOWN]
    soffit_row = 60  # first row of the flange, 600 mm up
    assert (down[soffit_row, :30] == g.FORMED).all()
    assert (down[soffit_row, 30:60] == g.INTERIOR).all()  # web carries on underneath
    assert not (down == g.GROUND).any()


def test_unknown_shape_raises() -> None:
    with pytest.raises(ValueError, match="unknown shape"):
        g.rasterize("trapezoid", {"width": 1.0}, dx_m=0.01)


# the core probe is a LOCATION. the old argmax-of-distance-transform cell walked up to
# 7.5 mm in y across dx = 5..20 mm and snapped back at 20 mm because ny was odd there.
# 3000 x 300 mm divides exactly at all four spacings, so the answer must be bit-identical.
def test_centroid_probe_is_identical_at_every_spacing() -> None:
    points = set()
    for dx_m in (0.005, 0.010, 0.015, 0.020):
        s = g.rasterize("slab", {"thickness": 300.0, "width": 3000.0}, dx_m=dx_m)
        points.add(s.stencil_xy_m(*s.probe_stencil(*s.centroid_m)))
    assert points == {(1.5, 0.15)}


# where dx does not divide the dimension the rasterised block really is a different
# element - a 700 mm beam at 15 mm cells is 705 mm tall. The probe still lands on that
# block's centroid, so the residual is quantisation of the SHAPE, bounded by dx/2.
def test_probe_residual_is_only_rasterisation_quantisation() -> None:
    for shape, dims in (
        ("beam", {"width": 300.0, "height": 700.0}),
        ("rect_column", {"width": 400.0, "height": 600.0}),
    ):
        for dx_m in (0.005, 0.010, 0.015, 0.020):
            s = g.rasterize(shape, dims, dx_m=dx_m)
            ny, nx = s.mask.shape
            probe = s.stencil_xy_m(*s.probe_stencil(*s.centroid_m))
            assert probe == pytest.approx((nx * dx_m / 2.0, ny * dx_m / 2.0))
            nominal = (dims["width"] / 2000.0, dims["height"] / 2000.0)
            assert np.max(np.abs(np.subtract(probe, nominal))) <= dx_m / 2.0


# a bilinear sample of a constant field is that constant, whatever the point.
def test_probe_stencil_weights_sum_to_one_and_stay_on_concrete() -> None:
    s = g.rasterize("t_section", {
        "flange_width": 900.0, "flange_thickness": 150.0,
        "web_width": 300.0, "height": 750.0,
    }, dx_m=0.01)
    rows, cols, w = s.probe_stencil(*s.centroid_m)
    assert w.sum() == pytest.approx(1.0)
    # a T-section centroid sits low in the web, but the fallback must land on concrete
    # even for a section whose centroid misses the mask entirely.
    assert s.mask[rows, cols].all()
