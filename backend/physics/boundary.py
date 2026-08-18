"""Per-face boundary conditions: convection, radiation, formwork, insulation."""

from dataclasses import dataclass

from physics import FloatArray

FACES = ("top", "bottom", "left", "right")


@dataclass(frozen=True)
class FaceCondition:
    """One face's thermal resistance to the outside world."""

    h_conv_w_m2_c: float      # convective coefficient, per celsius
    formwork_r_m2_c_w: float  # formwork thermal resistance
    emissivity: float
    exposed: bool


# combine convection, formwork, radiation into one effective coefficient.
def effective_h_w_m2_c(face: FaceCondition, wind_m_s: float, cloud_cover_pct: float) -> float:
    raise NotImplementedError


# heat flux out of each boundary cell, W/m2. positive = losing heat.
def face_flux_w_m2(
    surface_temp_c: FloatArray, ambient_temp_c: float, h_eff_w_m2_c: float
) -> FloatArray:
    raise NotImplementedError
