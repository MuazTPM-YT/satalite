"""Rasterise the 2D cross-section and tag every boundary face.

One source of truth: the outline polygon IS the rasteriser input, so the mask the
solver runs on and the outline the frontend extrudes can never drift apart.
"""

from dataclasses import dataclass

import numpy as np

from physics import BoolArray, FloatArray, IntArray, TagArray

SHAPES = (
    "slab",
    "wall",
    "rect_column",
    "circular_column",
    "beam",
    "t_section",
    "i_section",
    "l_section",
)

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

    mask: BoolArray           # (ny, nx) bool. True = concrete.
    face_tags: TagArray       # (4, ny, nx) uint8, one tag per direction per cell
    outline_m: list[list[float]]
    dx_m: float

    # cell centres in metres, (ny, nx) each.
    @property
    def centres_m(self) -> tuple[FloatArray, FloatArray]:
        ny, nx = self.mask.shape
        x = (np.arange(nx) + 0.5) * self.dx_m
        y = (np.arange(ny) + 0.5) * self.dx_m
        xs, ys = np.meshgrid(x, y)
        return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)

    # cross-section area from the mask, m2.
    @property
    def area_m2(self) -> float:
        return float(self.mask.sum()) * self.dx_m**2

    # mask-weighted centroid, metres. NOT the bounding-box centre: a T or an L carries
    # its area off to one side and the box centre can miss the concrete entirely.
    @property
    def centroid_m(self) -> tuple[float, float]:
        rows, cols = np.nonzero(self.mask)
        return (
            float((cols.mean() + 0.5) * self.dx_m),
            float((rows.mean() + 0.5) * self.dx_m),
        )

    # bilinear stencil for a physical point: rows, cols and weights that sum to 1.
    # Falls back to the nearest solid cell when the 2x2 would straddle a hole or the
    # outside, so a probe can never read a cell that holds no concrete.
    def probe_stencil(self, x_m: float, y_m: float) -> tuple[IntArray, IntArray, FloatArray]:
        ny, nx = self.mask.shape
        fx = min(max(x_m / self.dx_m - 0.5, 0.0), nx - 1.0)
        fy = min(max(y_m / self.dx_m - 0.5, 0.0), ny - 1.0)
        j0, i0 = int(np.floor(fx)), int(np.floor(fy))
        j1, i1 = min(j0 + 1, nx - 1), min(i0 + 1, ny - 1)
        tx, ty = fx - j0, fy - i0

        rows = np.array([i0, i0, i1, i1], dtype=np.int64)
        cols = np.array([j0, j1, j0, j1], dtype=np.int64)
        weights = np.array(
            [(1.0 - tx) * (1.0 - ty), tx * (1.0 - ty), (1.0 - tx) * ty, tx * ty],
            dtype=np.float64,
        )
        if bool(self.mask[rows, cols].all()):
            return rows, cols, weights

        solid_rows, solid_cols = np.nonzero(self.mask)
        k = int(np.argmin((solid_cols - fx) ** 2 + (solid_rows - fy) ** 2))
        return (
            np.array([solid_rows[k]], dtype=np.int64),
            np.array([solid_cols[k]], dtype=np.int64),
            np.array([1.0], dtype=np.float64),
        )

    # cells a surface sensor would sit in: one step of `depth_m` inward from every
    # EXPOSED face, along that face's own normal.
    #
    # This exists because the free surface and a sensor are not the same place. A
    # thermocouple cannot be cast AT the face; specs put it a few inches under one, and
    # the core-to-surface limit those specs write is a difference against THAT reading.
    # Comparing a core against the true free surface instead answers a question no code
    # asks, and answers it high - the face at 4am is far colder than 50 mm inside it.
    #
    # Steps along face_tags' own normals rather than a distance transform: the normal is
    # already stored, and "50 mm in from the face the sensor was fixed to" is what the
    # spec means, which is not the same as "50 mm from the nearest concrete edge" once a
    # section has a re-entrant corner. A step that lands outside the mask - a section
    # thinner than twice the depth - falls back to the boundary cell itself rather than
    # reading a cell with no concrete in it.
    def surface_probe_cells(self, depth_m: float) -> tuple[IntArray, IntArray]:
        if depth_m < 0.0:
            raise ValueError("depth_m must not be negative")
        steps = int(round(depth_m / self.dx_m))
        ny, nx = self.mask.shape

        rows: list[int] = []
        cols: list[int] = []
        # (direction, row step, col step). Inward is the OPPOSITE of the face normal:
        # an UP face is looked at from below, so the sensor is at a lower row.
        inward = ((UP, -1, 0), (DOWN, 1, 0), (LEFT, 0, 1), (RIGHT, 0, -1))
        for direction, dr, dc in inward:
            face_rows, face_cols = np.nonzero(self.face_tags[direction] == EXPOSED)
            probe_rows = np.clip(face_rows + dr * steps, 0, ny - 1)
            probe_cols = np.clip(face_cols + dc * steps, 0, nx - 1)
            inside = self.mask[probe_rows, probe_cols]
            rows.extend(np.where(inside, probe_rows, face_rows).tolist())
            cols.extend(np.where(inside, probe_cols, face_cols).tolist())

        if not rows:
            return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int64)
        return np.asarray(rows, dtype=np.int64), np.asarray(cols, dtype=np.int64)

    # where a stencil actually samples, metres. exact for bilinear, honest for the
    # nearest-cell fallback - the metadata must not claim a point that was not read.
    def stencil_xy_m(
        self, rows: IntArray, cols: IntArray, weights: FloatArray
    ) -> tuple[float, float]:
        return (
            float(np.dot(cols + 0.5, weights) * self.dx_m),
            float(np.dot(rows + 0.5, weights) * self.dx_m),
        )


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
        # not `a`: the section branches below bind `a` to a flange offset, and one name
        # holding an array here and a float there is a name doing two jobs.
        angles = np.linspace(0.0, 2.0 * np.pi, CIRCLE_SEGMENTS, endpoint=False)
        return [[float(r + r * np.cos(t)), float(r + r * np.sin(t))] for t in angles]
    if shape == "t_section":
        fw, ft, ww, h = mm("flange_width"), mm("flange_thickness"), mm("web_width"), mm("height")
        a, b, y = (fw - ww) / 2.0, (fw + ww) / 2.0, h - ft
        return [[a, 0.0], [b, 0.0], [b, y], [fw, y], [fw, h], [0.0, h], [0.0, y], [a, y]]
    if shape == "i_section":
        fw, ft, ww, h = mm("flange_width"), mm("flange_thickness"), mm("web_width"), mm("height")
        a, b = (fw - ww) / 2.0, (fw + ww) / 2.0
        return [
            [0.0, 0.0], [fw, 0.0], [fw, ft], [b, ft], [b, h - ft], [fw, h - ft],
            [fw, h], [0.0, h], [0.0, h - ft], [a, h - ft], [a, ft], [0.0, ft],
        ]
    if shape == "l_section":
        w, h, t = mm("width"), mm("height"), mm("leg_thickness")
        return [[0.0, 0.0], [w, 0.0], [w, t], [t, t], [t, h], [0.0, h]]
    raise ValueError(f"unknown shape {shape!r}, expected one of {SHAPES}")


# axis-aligned rectangle anchored at the origin.
def _rect(w_m: float, h_m: float) -> list[list[float]]:
    return [[0.0, 0.0], [w_m, 0.0], [w_m, h_m], [0.0, h_m]]


# even-odd ray cast, vectorised over cells and looped over the few polygon edges.
def _inside(poly: list[list[float]], xs: FloatArray, ys: FloatArray) -> BoolArray:
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
