"""Shape library and rasteriser for the 2D pour cross-section."""

from dataclasses import dataclass

from physics import FloatArray

SHAPES = ("slab", "wall", "column", "footing", "beam")


@dataclass(frozen=True)
class Grid:
    """Rasterised cross-section. mask True = concrete, False = outside."""

    mask: FloatArray
    cell_size_m: float


# name plus size in, filled mask out.
def rasterise(shape: str, width_m: float, height_m: float, cell_size_m: float) -> Grid:
    raise NotImplementedError


# which cells touch air. needed so boundary.py knows where to apply losses.
def face_cells(grid: Grid) -> dict[str, FloatArray]:
    raise NotImplementedError
