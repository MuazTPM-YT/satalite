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

    cementitious_kg_m3: float  # C_c, TOTAL cementitious content: cement + fly ash + any SCM
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
            self.h_u_j_per_kg * self.cementitious_kg_m3 * self.alpha_u
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
    # how deep under the face a surface sensor is taken to sit, metres. A CHOICE, not a
    # constant, and it has to match whatever the governing spec says - ACI 207 says only
    # "a few inches below the nearest surface", ALDOT 930-860R instrumented at 1 in and
    # USBR DSO-12-02 at 6 in. 50 mm (2 in) is the common DOT thermal-control-plan value
    # and is the default for that reason alone. Echoed back in every response.
    surface_probe_depth_m: float = 0.050
    # where the reported core temperature is sampled, metres from the section origin.
    # None means the section centroid. A LOCATION, never a cell: the number has to be a
    # property of the element, comparable to a thermocouple that sat at a known point.
    probe_xy_m: tuple[float, float] | None = None


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
    # temperature a surface sensor would read: the mean over cells one
    # Element.surface_probe_depth_m step inward from every exposed face. This is the
    # series a spec's core-to-surface limit is written against; surface_temp_c is the
    # true free surface and is colder.
    surface_probe_temp_c: FloatArray
    peak_core_temp_c: float
    peak_core_time_h: float
    max_core_surface_diff_c: float
    # same differential measured from the hottest cell instead of the probe. Cracking
    # happens across the real gradient, and the probe is a nominal point that sits below
    # it - so this is the conservative one and the flag is evaluated on both.
    max_anywhere_surface_diff_c: float
    # hottest cell anywhere in the section, over the whole run. What DEF actually cares
    # about - the nominal centre is not where the element is hottest.
    max_core_temp_anywhere_c: float
    # the same two differentials measured against the surface SENSOR rather than the free
    # surface. These are what the cracking flag is evaluated on, because ACI 301's 35 degF
    # is written against an embedded reading. The free-surface pair above is kept and
    # still reported: it is the strict upper bound on the gradient, and dropping it would
    # hide how much of the difference is probe placement.
    max_core_probe_diff_c: float
    max_anywhere_probe_diff_c: float
    # echoed so a reader never has to infer which depth produced the numbers above.
    surface_probe_depth_m: float
    # where core_temp_c was sampled. Echoed so a reader never has to infer it.
    probe_xy_m: tuple[float, float]
    dt_s: float
    outline_m: list[list[float]] = field(default_factory=list)
