"""Plain dataclasses at the physics boundary. Not pydantic - physics/ stays pure."""

from dataclasses import dataclass, field

from physics import FloatArray
from physics.constants import (
    BETA_DEFAULT,
    CP_DEFAULT,
    H_CEM_DEFAULT,
    K_DEFAULT,
    RHO_DEFAULT,
)


@dataclass(frozen=True)
class Mix:
    """A concrete mix, already reduced to the numbers the solver needs.

    Build the hydration parameters with equations/hydration.py - this holds results,
    it does not derive them.
    """

    cement_kg_m3: float       # C_c, binder content
    h_u_j_per_kg: float       # H_u. J/kg. NOT J/g. trap 1.
    alpha_u: float            # ultimate degree of hydration
    tau_h: float              # hydration time parameter, hours
    beta: float = BETA_DEFAULT
    # the cement heat h_u_j_per_kg was derived from, J/g. Carried so the ensemble can
    # scale h_u around the RIGHT mean: a Type II/V mix built at 470 must be perturbed
    # about 470, not about the global default.
    h_cem_j_per_g: float = H_CEM_DEFAULT
    rho_kg_m3: float = RHO_DEFAULT
    cp_j_kg_k: float = CP_DEFAULT
    k_w_m_k: float = K_DEFAULT

    # thermal diffusivity m2/s. derived, never stored.
    @property
    def alpha_m2_s(self) -> float:
        return self.k_w_m_k / (self.rho_kg_m3 * self.cp_j_kg_k)

    # closed-form adiabatic rise if all hydration heat stays put. celsius.
    @property
    def adiabatic_rise_c(self) -> float:
        return (
            self.h_u_j_per_kg * self.cement_kg_m3 * self.alpha_u
        ) / (self.rho_kg_m3 * self.cp_j_kg_k)


@dataclass(frozen=True)
class Element:
    """What is being poured: cross-section, formwork, placement temperature."""

    shape: str
    dims_mm: dict[str, float]
    dx_m: float = 0.01
    placement_temp_c: float = 20.0
    formwork: str = "plywood_18mm"
    on_ground: bool = False


@dataclass(frozen=True)
class Ambient:
    """Hourly weather over the run. Every array shares the same length as hours."""

    hours: FloatArray         # hours since placement
    air_temp_c: FloatArray
    rh_frac: FloatArray       # 0-1, not percent
    wind_ms: FloatArray
    cloud_pct: FloatArray     # PERCENT 0-100 despite the api calling it octas
    ghi_w_m2: FloatArray      # global horizontal irradiance already shaped hourly
    sky_offset_c: float = 6.0


@dataclass
class SolveResult:
    """Everything downstream needs. Fields are recorded on the frame cadence,
    scalars are over the whole run."""

    times_h: FloatArray
    temp_c_frames: FloatArray      # (n_frames, ny, nx), nan outside the mask
    t_e_h_frames: FloatArray       # equivalent age, same shape
    core_temp_c: FloatArray
    surface_temp_c: FloatArray
    peak_core_temp_c: float
    peak_core_time_h: float
    max_core_surface_diff_c: float
    dt_s: float
    outline_m: list[list[float]] = field(default_factory=list)
