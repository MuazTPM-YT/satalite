"""Pydantic schemas for the API boundary. Units live in field names."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from physics.constants import H_CEM_BY_TYPE, T_REF_DEFAULT_C
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
    # [x, y] metres from the section origin. None samples the section centroid.
    probe_xy_m: list[float] | None = Field(default=None, min_length=2, max_length=2)

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
        # geometry.rasterize tags the base GROUND, but the solver counts only EXPOSED and
        # FORMED faces, so a ground face carries zero h and zero q - a perfectly insulated
        # base. That over-predicts the core, over-predicts maturity and makes strip times
        # optimistic, which is the unsafe direction. Refuse rather than solve it. The
        # semi-infinite soil sink of master 4.6 is the fix and it is not in this build.
        if self.on_ground:
            raise ValueError(
                "ground boundary not modelled in this build: a GROUND face currently "
                "carries zero flux, which is an insulated base and biases the core HIGH. "
                "Set on_ground=false."
            )
        return self


class MixSpec(BaseModel):
    """Either name the standard mix or give every hydration parameter explicitly."""

    mix_id: str = "standard"
    # ASTM C150 type. Picks the cement heat: C3A carries the largest Bogue coefficient
    # (866 J/g) and Type V is low-C3A by definition, so a II/V blend makes less heat per
    # unit cement. None means unknown, which falls back to H_CEM_DEFAULT rather than
    # guessing a type - guessing "V" would quietly relax every temperature prediction.
    cement_type: str | None = None
    cement_kg_m3: float | None = Field(default=None, gt=0.0)
    h_u_j_per_kg: float | None = Field(default=None, gt=0.0)
    alpha_u: float | None = Field(default=None, gt=0.0, le=1.09)
    tau_h: float | None = Field(default=None, gt=0.0)
    beta: float | None = Field(default=None, gt=0.0)
    grade: str = "4000psi"

    # reject an unknown cement type at the boundary, not by silently defaulting.
    @model_validator(mode="after")
    def _known_cement_type(self) -> "MixSpec":
        if self.cement_type is not None and self.cement_type not in H_CEM_BY_TYPE:
            raise ValueError(
                f"unknown cement_type {self.cement_type!r}, expected one of "
                f"{sorted(H_CEM_BY_TYPE)} or null for unknown"
            )
        return self


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


# which quantity crossed a limit. A plain str let a typo through the boundary silently.
TrippedBy = Literal["probe", "max_anywhere", "both", "none"]


class BreachFlags(BaseModel):
    """What this run trips. Thresholds echoed so a reader never has to guess them."""

    def_risk: bool
    def_threshold_c: float
    def_tripped_by: TrippedBy
    cracking: bool
    cracking_limit_c: float
    cracking_tripped_by: TrippedBy
    evaporation: bool
    evaporation_limit_kg_m2_h: float
    placement: bool
    placement_limit_c: float


# maturity reference temperature, celsius. A CHOICE, not a constant - master 4.4 says
# so and says it must match the strength calibration. Exposed here rather than left at a
# silent default, because a run at 20 C read against parameters fitted at 23 C is a
# systematic offset nobody can see.
T_REF_FIELD = Field(default=T_REF_DEFAULT_C, gt=0.0, le=40.0)


class SimulationRequest(BaseModel):
    element: ElementSpec
    mix: MixSpec = MixSpec()
    ambient: AmbientSpec
    duration_hours: float = Field(default=72.0, gt=0.0, le=336.0)
    t_ref_c: float = T_REF_FIELD


class FieldFrames(BaseModel):
    """Per-cell temperature on the solver's own grid, for the heatmap.

    The solver already computes this every step; it was simply never serialised. It is
    opt-in because it is large: 433 frames of a 300x30 slab is 3.9 million numbers, which
    is tens of megabytes of json. `fields_stride_h` thins the FRAME axis only - x and y
    are never resampled, because a resampled cell is a number the solver did not compute.

    Row 0 is the base and y increases upward, matching physics.geometry. Cell (j, i) has
    its centre at ((i + 0.5) * dx_m, (j + 0.5) * dx_m).
    """

    nx: int
    ny: int
    dx_m: float
    # the subset of SimulationResult.times_h these frames were recorded at.
    times_h: list[float]
    # indices into SimulationResult.times_h, so a caller can line a frame up against the
    # core/surface series without matching floats.
    frame_indices: list[int]
    # [frame][y][x] celsius. null OUTSIDE THE MASK, never a number: a filled hole reads
    # as concrete at ambient, and there is no concrete there to be at any temperature.
    temp_c: list[list[list[float | None]]]


class SimulationResult(BaseModel):
    times_h: list[float]
    core_temp_c: list[float]
    surface_temp_c: list[float]
    equivalent_age_h: list[float]
    strength_fraction: list[float]
    peak_core_temp_c: float
    peak_core_time_h: float
    max_core_surface_diff_c: float
    # the same differential from the hottest point, not the probe. The conservative one.
    max_anywhere_surface_diff_c: float
    # hottest point anywhere in the section, not the probe. The DEF-relevant number.
    max_core_temp_anywhere_c: float
    # where peak_core_temp_c was actually sampled, [x, y] metres. Run metadata.
    probe_xy_m: list[float]
    # the maturity reference temperature this run integrated at. Run metadata, and it
    # must be read next to the strength numbers: master 4.4 requires T_ref match the
    # strength calibration, and this is the only place a caller can see which one it got.
    t_ref_c: float
    peak_evaporation_kg_m2_h: float
    strip_time_h: float | None
    breaches: BreachFlags
    outline_m: list[list[float]]
    ensemble: EnsembleResult | None = None
    # only present when the caller asked for it with ?fields=true.
    fields: FieldFrames | None = None


class PourWindowCandidate(BaseModel):
    offset_h: float
    placement_temp_c: float
    peak_core_temp_c: float
    max_core_temp_anywhere_c: float
    max_core_surface_diff_c: float
    max_anywhere_surface_diff_c: float
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
    t_ref_c: float = T_REF_FIELD
    # OFF by default. The candidate sweep is seconds; the ensemble on the pick is a
    # minute, and a minute on a request thread is a gateway timeout on a free tier.
    # Ask for it explicitly, or read the precomputed band from /api/demo-ensemble.
    ensemble: bool = False
    ensemble_samples: int = Field(default=300, ge=1, le=2000)
    seed: int = 0


class PourWindowResult(BaseModel):
    candidates: list[PourWindowCandidate]
    best_offset_h: float
    ensemble: EnsembleResult | None = None


class DemoEnsembleResponse(BaseModel):
    """Precomputed bands for ONE fixed scenario. Served from disk, never solved live.

    The scenario travels with the band on purpose. A band drawn beside a pour it was not
    computed for is worse than no band at all, so a reader has to be able to see what it
    describes. Anything the caller changes in the UI invalidates this payload.
    """

    scenario: SimulationRequest
    ensemble: EnsembleResult
    built_at: str
    sampler: str
    dt_s: float
    sampled_parameters: list[str]
    note: str


class SeasonAnalysisResponse(BaseModel):
    """Precomputed. Served straight from cache, never solved at request time.

    The artifact is optional: a season costs 4220 credits a day to fetch, so an image
    can ship without one. available=False says so plainly at 200 - a dead 503 in a live
    demo reads as a broken backend, which is worse than a feature that is simply absent.
    """

    available: bool = True
    detail: str | None = None
    n_days: int | None = None
    date_range: list[str] | None = None
    # how the days were drawn from that range: strided or consecutive, and how densely.
    sampling: dict[str, Any] | None = None
    placement_hours: list[int] | None = None
    per_placement_hour: dict[str, dict[str, Any]] | None = None
    delta_14_minus_04: dict[str, float] | None = None
    element: dict[str, Any] | None = None
    limits: dict[str, Any] | None = None
    assumptions: dict[str, Any] | None = None


class ValidationResponse(BaseModel):
    """Summary of validation/ against the USBR cases.

    The primary metric is band coverage, not point error: DSO-12-02 publishes no cement
    chemistry, so a point prediction there would test four unmeasured numbers.
    """

    cases: list[dict[str, Any]]
    generated_at: str | None = None
    primary_metric: str = "coverage_pct"
    coverage_pass_pct: float | None = None
    band_width_warn_c: float | None = None
    n_samples: int | None = None
    assumed_chemistry_ranges: dict[str, dict[str, list[float]]] = {}
    notes: list[str] = []
