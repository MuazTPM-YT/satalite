"""Pydantic schemas for the API boundary. Units live in field names."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from physics.equations.boundary import FORMWORK_R
from physics.geometry import SHAPES


class HealthResponse(BaseModel):
    status: str
    version: str


class LatLon(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class TemperatureRequest(BaseModel):
    """Where and when to pull air temperature from FortyGuard."""

    site: LatLon
    start_date: str
    end_date: str | None = None
    granularity_m: int = 100


class TemperaturePoint(BaseModel):
    at: datetime
    air_temp_c: float


class TemperatureSeries(BaseModel):
    activity_id: str | None = None
    points: list[TemperaturePoint]


class ElementSpec(BaseModel):
    """2D cross-section of the pour. Shapes come from physics.geometry.SHAPES."""

    shape: str
    dims_mm: dict[str, float]
    dx_m: float = Field(default=0.01, gt=0.0, le=0.1)
    placement_temp_c: float = Field(default=20.0, ge=0.0, le=50.0)
    formwork: str = "plywood_18mm"
    on_ground: bool = False

    # reject unknown shapes and formwork here, at the boundary, not with a KeyError
    # three layers down inside the solver.
    @model_validator(mode="after")
    def _known_names(self) -> "ElementSpec":
        if self.shape not in SHAPES:
            raise ValueError(f"unknown shape {self.shape!r}, expected one of {SHAPES}")
        if self.formwork not in FORMWORK_R:
            raise ValueError(
                f"unknown formwork {self.formwork!r}, expected one of {sorted(FORMWORK_R)}"
            )
        return self


class MixSpec(BaseModel):
    """Either name the standard mix or give every hydration parameter explicitly."""

    mix_id: str = "standard"
    cement_kg_m3: float | None = Field(default=None, gt=0.0)
    h_u_j_per_kg: float | None = Field(default=None, gt=0.0)
    alpha_u: float | None = Field(default=None, gt=0.0, le=1.09)
    tau_h: float | None = Field(default=None, gt=0.0)
    beta: float | None = Field(default=None, gt=0.0)
    grade: str = "4000psi"


class AmbientSpec(BaseModel):
    """Hourly weather. Every list shares the length of hours_h."""

    hours_h: list[float]
    air_temp_c: list[float]
    rh_frac: list[float]
    wind_ms: list[float]
    cloud_pct: list[float]
    ghi_w_m2: list[float]
    sky_offset_c: float = 6.0

    # ragged weather arrays would interpolate into silent nonsense. catch it at the edge.
    @model_validator(mode="after")
    def _same_length(self) -> "AmbientSpec":
        n = len(self.hours_h)
        if n < 2:
            raise ValueError("ambient needs at least two hours to interpolate between")
        lengths = {
            "air_temp_c": len(self.air_temp_c),
            "rh_frac": len(self.rh_frac),
            "wind_ms": len(self.wind_ms),
            "cloud_pct": len(self.cloud_pct),
            "ghi_w_m2": len(self.ghi_w_m2),
        }
        wrong = {name: got for name, got in lengths.items() if got != n}
        if wrong:
            raise ValueError(f"ambient arrays must all be length {n}, got {wrong}")
        if any(not 0.0 <= v <= 1.0 for v in self.rh_frac):
            raise ValueError("rh_frac is a fraction 0-1, not a percentage")
        if any(not 0.0 <= v <= 100.0 for v in self.cloud_pct):
            raise ValueError("cloud_pct is PERCENT 0-100 despite the API calling it octas")
        return self


class Bands(BaseModel):
    """Percentile envelope over the ensemble, one value per recorded frame."""

    p05: list[float]
    p25: list[float]
    p50: list[float]
    p75: list[float]
    p95: list[float]


class EnsembleResult(BaseModel):
    n_samples: int
    seed: int
    dx_m: float
    core_temp_c: Bands
    surface_temp_c: Bands
    strength_fraction: Bands
    equivalent_age_h: Bands
    strength_probability: list[float]
    strip_time_h_p95: float | None
    forecast_error: dict[str, Any]


class BreachFlags(BaseModel):
    """What this run trips. Thresholds echoed so a reader never has to guess them."""

    def_risk: bool
    def_threshold_c: float
    cracking: bool
    cracking_limit_c: float
    evaporation: bool
    evaporation_limit_kg_m2_h: float
    placement: bool
    placement_limit_c: float


class SimulationRequest(BaseModel):
    element: ElementSpec
    mix: MixSpec = MixSpec()
    ambient: AmbientSpec
    duration_hours: float = Field(default=72.0, gt=0.0, le=336.0)


class SimulationResult(BaseModel):
    times_h: list[float]
    core_temp_c: list[float]
    surface_temp_c: list[float]
    equivalent_age_h: list[float]
    strength_fraction: list[float]
    peak_core_temp_c: float
    peak_core_time_h: float
    max_core_surface_diff_c: float
    peak_evaporation_kg_m2_h: float
    strip_time_h: float | None
    breaches: BreachFlags
    outline_m: list[list[float]]
    ensemble: EnsembleResult | None = None


class PourWindowCandidate(BaseModel):
    offset_h: float
    placement_temp_c: float
    peak_core_temp_c: float
    max_core_surface_diff_c: float
    peak_evaporation_kg_m2_h: float
    strip_time_h: float | None
    breaches: BreachFlags
    n_breaches: int


class PourWindowRequest(BaseModel):
    element: ElementSpec
    mix: MixSpec = MixSpec()
    ambient: AmbientSpec
    candidate_offsets_h: list[float] = Field(min_length=1, max_length=24)
    duration_hours: float = Field(default=72.0, gt=0.0, le=336.0)
    ensemble_samples: int = Field(default=300, ge=1, le=2000)
    seed: int = 0


class PourWindowResult(BaseModel):
    candidates: list[PourWindowCandidate]
    best_offset_h: float
    ensemble: EnsembleResult


class SeasonAnalysisResponse(BaseModel):
    """Precomputed. Served straight from cache, never solved at request time."""

    n_days: int
    date_range: list[str]
    placement_hours: list[int]
    per_placement_hour: dict[str, dict[str, Any]]
    delta_14_minus_04: dict[str, float] | None
    element: dict[str, Any]
    limits: dict[str, Any]
    assumptions: dict[str, Any]


class ValidationResponse(BaseModel):
    """Summary of validation/ against the USBR cases."""

    cases: list[dict[str, Any]]
    generated_at: str | None = None
    notes: list[str] = []
