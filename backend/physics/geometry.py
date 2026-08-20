"""Rasterise the 2D cross-section and tag every boundary face.

One source of truth: the outline polygon IS the rasteriser input, so the mask the
solver runs on and the outline the frontend extrudes can never drift apart.
"""

from dataclasses import dataclass

import numpy as np

from physics import FloatArray

SHAPES = ("slab", "wall", "rect_column", "circular_column", "beam", "t_section", "l_section")

# face directions, in the order face_tags stores them. y increases upward, row 0 is the base.
UP, DOWN, LEFT, RIGHT = 0, 1, 2, 3
DIRECTIONS = (UP, DOWN, LEFT, RIGHT)

# face tags. powers of two so a face can be tested with a bitwise and.
INTERIOR = 0
EXPOSED = 1
FORMED = 2
GROUND = 4
ADIABATIC = 8

CIRCLE_SEGMENTS = 128


@dataclass(frozen=True)
class Section:
    """Rasterised cross-section plus the outline it came from."""

    mask: np.ndarray          # (ny, nx) bool. True = concrete.
    face_tags: np.ndarray     # (4, ny, nx) uint8, one tag per direction per cell
    outline_m: list[list[float]]
    dx_m: float

    # cell centres in metres, (ny, nx) each.
    @property
    def centres_m(self) -> tuple[FloatArray, FloatArray]:
        ny, nx = self.mask.shape
        x = (np.arange(nx) + 0.5) * self.dx_m
        y = (np.arange(ny) + 0.5) * self.dx_m
        return np.meshgrid(x, y)

    # cross-section area from the mask, m2.
    @property
    def area_m2(self) -> float:
        return float(self.mask.sum()) * self.dx_m**2


# shape name plus mm dimensions in, closed outline polygon in metres out.
def outline(shape: str, dims_mm: dict[str, float]) -> list[list[float]]:
    def mm(key: str) -> float:
        return dims_mm[key] / 1000.0

    if shape == "slab":
        return _rect(mm("width"), mm("thickness"))
    if shape == "wall":
        return _rect(mm("thickness"), mm("height"))
    if shape in ("rect_column", "beam"):
        return _rect(mm("width"), mm("height"))
    if shape == "circular_column":
        r = mm("diameter") / 2.0
        a = np.linspace(0.0, 2.0 * np.pi, CIRCLE_SEGMENTS, endpoint=False)
        return [[float(r + r * np.cos(t)), float(r + r * np.sin(t))] for t in a]
    if shape == "t_section":
        fw, ft, ww, h = mm("flange_width"), mm("flange_thickness"), mm("web_width"), mm("height")
        a, b, y = (fw - ww) / 2.0, (fw + ww) / 2.0, h - ft
        return [[a, 0.0], [b, 0.0], [b, y], [fw, y], [fw, h], [0.0, h], [0.0, y], [a, y]]
    if shape == "l_section":
        w, h, t = mm("width"), mm("height"), mm("leg_thickness")
        return [[0.0, 0.0], [w, 0.0], [w, t], [t, t], [t, h], [0.0, h]]
    raise ValueError(f"unknown shape {shape!r}, expected one of {SHAPES}")


# axis-aligned rectangle anchored at the origin.
def _rect(w_m: float, h_m: float) -> list[list[float]]:
    return [[0.0, 0.0], [w_m, 0.0], [w_m, h_m], [0.0, h_m]]


# even-odd ray cast, vectorised over cells and looped over the few polygon edges.
def _inside(poly: list[list[float]], xs: FloatArray, ys: FloatArray) -> np.ndarray:
    inside = np.zeros(xs.shape, dtype=bool)
    x1, y1 = poly[-1]
    for x2, y2 in poly:
        if y1 != y2:
            crosses = (y1 > ys) != (y2 > ys)
            x_at_y = x1 + (ys - y1) * (x2 - x1) / (y2 - y1)
            inside ^= crosses & (xs < x_at_y)
        x1, y1 = x2, y2
    return inside


# shape plus dims in, mask and per-cell face tags out.
def rasterize(
    shape: str, dims_mm: dict[str, float], dx_m: float = 0.01, on_ground: bool = False
) -> Section:
    poly = outline(shape, dims_mm)
    pts = np.asarray(poly, dtype=np.float64)
    w_m, h_m = float(pts[:, 0].max()), float(pts[:, 1].max())
    nx, ny = max(int(round(w_m / dx_m)), 1), max(int(round(h_m / dx_m)), 1)

    xs, ys = np.meshgrid((np.arange(nx) + 0.5) * dx_m, (np.arange(ny) + 0.5) * dx_m)
    mask = _inside(poly, xs, ys)

    # a slab is a strip cut from a much wider pour, so its sides are symmetry planes.
    side_tag = ADIABATIC if shape == "slab" else FORMED
    base_tag = GROUND if on_ground else FORMED
    lowest_row = int(mask.any(axis=1).argmax())

    pad = np.pad(mask, 1, constant_values=False)
    neighbour = {
        UP: pad[2:, 1:-1],
        DOWN: pad[:-2, 1:-1],
        LEFT: pad[1:-1, :-2],
        RIGHT: pad[1:-1, 2:],
    }

    face_tags = np.zeros((4, ny, nx), dtype=np.uint8)
    for d in DIRECTIONS:
        exterior = mask & ~neighbour[d]
        if d == UP:
            face_tags[d][exterior] = EXPOSED       # the free finished surface
        elif d == DOWN:
            rows = np.zeros_like(mask)
            rows[lowest_row] = True
            face_tags[d][exterior & rows] = base_tag
            face_tags[d][exterior & ~rows] = FORMED  # soffits, e.g. under a T flange
        else:
            face_tags[d][exterior] = side_tag

    return Section(mask=mask, face_tags=face_tags, outline_m=poly, dx_m=dx_m)
