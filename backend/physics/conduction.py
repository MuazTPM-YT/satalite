"""2D masked finite-difference heat conduction. Explicit scheme."""

from dataclasses import dataclass

from physics import FloatArray
from physics.geometry import Grid
from physics.mixes import Mix


@dataclass(frozen=True)
class StepResult:
    """One timestep of the solver, with the energy terms the golden test checks."""

    temp_c: FloatArray
    heat_generated_j: float
    heat_stored_j: float
    heat_lost_j: float


# biggest stable dt for this grid and mix. explicit scheme, so cfl bites.
def max_stable_dt_s(grid: Grid, mix: Mix) -> float:
    raise NotImplementedError


# march one timestep. celsius in, celsius out.
def step(
    temp_c: FloatArray,
    grid: Grid,
    mix: Mix,
    dt_s: float,
    source_w_m3: FloatArray,
    ambient_temp_c: float,
    h_eff_w_m2_c: dict[str, float],
) -> StepResult:
    raise NotImplementedError


# full run. ambient series in celsius, temperature history in celsius out.
def solve(
    grid: Grid,
    mix: Mix,
    placement_temp_c: float,
    ambient_temp_c: FloatArray,
    dt_s: float,
    duration_s: float,
    h_eff_w_m2_c: dict[str, float],
    seed: int = 0,
) -> FloatArray:
    raise NotImplementedError
