"""Pydantic schemas for the API boundary. Units live in field names."""

from datetime import datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field, model_validator

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
    # how deep under the face the surface sensor is taken to sit, metres. A CHOICE that
    # has to match the governing spec, exactly like t_ref_c: ACI 207 says only "a few
    # inches below the nearest surface", ALDOT 930-860R instrumented at 1 in (0.025) and
    # USBR DSO-12-02 at 6 in (0.152). 0.050 is the common DOT thermal-control-plan value.
    # The cracking flag is evaluated against this reading, not against the free surface.
    surface_probe_depth_m: float = Field(default=0.050, ge=0.0, le=0.5)

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
    # TOTAL cementitious content, not the cement alone: cement + fly ash + any other SCM.
    # The old name "cement_kg_m3" said the opposite of what it held and is still accepted
    # on the wire so existing payloads keep working.
    cementitious_kg_m3: float | None = Field(
        default=None,
        gt=0.0,
        validation_alias=AliasChoices("cementitious_kg_m3", "cement_kg_m3"),
    )
    # Mix DESIGN, not solver parameters. Supplying cementitious_kg_m3 with these two - and
    # without h_u/alpha_u/tau_h - asks the service to derive the hydration parameters
    # the same way physics.season_analysis.standard_mix does, from the same published
    # regressions. Supplying h_u/alpha_u/tau_h instead pins them directly.
    w_cm: float | None = Field(default=None, gt=0.0, le=1.2)
    fly_ash_frac: float | None = Field(default=None, ge=0.0, le=0.6)
    # Silica fume as a fraction of total cementitious. Schindler-Folliard 2005 regresses
    # Class F ash, Class C ash and GGBF slag ONLY: there is no silica fume term in H_u,
    # tau, beta or alpha_u. So this fraction is carried as MASS and generates NO heat.
    # It exists because without it the cement fraction is overstated by exactly this
    # much, and every non-fly-ash binder gets counted as cement.
    #
    # There is deliberately no slag field. Slag is NOT inert - it carries a 461 J/g heat
    # term, an alpha_u term and a tau term - so accepting it here without wiring those
    # would under-predict temperature, which is the direction that misses a DEF flag.
    # Until a validation case contains slag, a slag mix is not expressible.
    silica_fume_frac: float | None = Field(default=None, ge=0.0, le=0.15)
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

    # the SCM fractions come out of the cement fraction, so together they cannot reach 1:
    # that would be a binder with no cement in it, and H_u would collapse to the ash term.
    @model_validator(mode="after")
    def _scm_fractions_leave_cement(self) -> "MixSpec":
        scm = (self.fly_ash_frac or 0.0) + (self.silica_fume_frac or 0.0)
        if scm >= 1.0:
            raise ValueError(
                f"fly_ash_frac + silica_fume_frac = {scm:.3f} leaves no cement; "
                "both are fractions of TOTAL cementitious content"
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


class AmbientRequest(BaseModel):
    """Where and when to build an hourly ambient for. US coordinates only.

    allow_live is the money switch. A site-day that is not already on disk costs 4220
    credits to fetch, so the default refuses and reports the price instead of paying it.
    """

    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)
    date: str
    placement_hour: int = Field(default=14, ge=0, le=23)
    duration_hours: float = Field(default=72.0, gt=0.0, le=336.0)
    # False refuses to spend. True is an explicit "yes, buy this day".
    allow_live: bool = False
    # WHICH measured triple shapes the diurnal curve.
    #
    # "aoi_mean" averages every tile in the AOI. That is the reducer the season replay
    # and every precomputed artifact were built with, so it stays the default - changing
    # it here would silently move numbers that are already written down on disk.
    #
    # "tile" uses the one tile the lat/lon actually falls in. That is the hyperlocal
    # answer, and it is the point of picking a spot on the map rather than a city: over
    # the demo AOI the daily minimum spreads 0.37 C between tiles, which is real
    # exposure the mean flattens. A point outside every tile falls back to the mean and
    # the response says so.
    reduce: Literal["aoi_mean", "tile"] = "aoi_mean"


class AmbientResponse(BaseModel):
    """An hourly ambient, plus exactly where and what it was built from.

    lat/lon are echoed the way t_ref_c and probe_xy_m are: the latitude reached
    physics.season_analysis.build_ambient, which is what sets solar declination, sunset
    hour angle and daylength, so a reader never has to infer which location was solved.
    """

    ambient: AmbientSpec
    resolved_lat_deg: float
    resolved_lon_deg: float
    # echoed for the same reason: the day and hour the series was actually built for.
    resolved_date: str
    resolved_placement_hour: int
    coverage: str            # which US coverage box holds the point
    mode: str                # "archive" or "forecast"
    source: str              # "cached" or "live"
    credits_spent: int
    day_of_year: int
    # Which reducer produced the triple below, and the tile it came from when that was
    # one tile. Echoed rather than assumed: a curve built from one 100 m tile and a curve
    # built from 221 of them are different answers, and a reader must never have to guess
    # which is on screen. "tile" was ASKED FOR and GRANTED; a request for "tile" whose
    # point fell outside every tile comes back "aoi_mean" here, with tile_id null.
    reduction: str
    tile_id: str | None = None
    n_tiles: int
    # the daily triple build_ambient shaped the Parton-Logan curve from.
    t_min_c: float
    t_mean_c: float
    t_max_c: float


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
    # what a surface sensor at surface_probe_depth_m would read, and the two differentials
    # measured against it. THESE are what breaches.cracking is evaluated on: ACI 301's
    # 35 degF is written against an embedded reading, and the free-surface pair above
    # answers a different question - it is the strict upper bound on the gradient, kept
    # so a reader can see how much of the difference is probe placement.
    surface_probe_temp_c: list[float]
    max_core_probe_diff_c: float
    max_anywhere_probe_diff_c: float
    surface_probe_depth_m: float
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
    # the sensor-depth pair, which is what this row's cracking flag actually fired on.
    max_core_probe_diff_c: float
    max_anywhere_probe_diff_c: float
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


class Site(BaseModel):
    """Where and when a precomputed artifact was built for.

    source says how the daily min/mean/max were obtained, and it is not decoration:
    "cached" means a FortyGuard day that is on disk, "stated" means the three numbers
    were written down because no season sat in the cache when the artifact was built.
    A stated day must never be presented as an observation.
    """

    label: str
    lat_deg: float
    lon_deg: float
    date: str
    placement_hour: int
    source: str


class DemoEnsembleResponse(BaseModel):
    """Precomputed bands for ONE fixed scenario. Served from disk, never solved live.

    The scenario travels with the band on purpose. A band drawn beside a pour it was not
    computed for is worse than no band at all, so a reader has to be able to see what it
    describes. Anything the caller changes in the UI invalidates this payload.
    """

    scenario: SimulationRequest
    ensemble: EnsembleResult
    # Where the scenario is. None for an artifact built before this field existed - the
    # studio then shows no location rather than inventing one.
    site: Site | None = None
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


class HeatmapTile(BaseModel):
    """One FortyGuard tile: the ground it covers, and what the day did inside it.

    The footprint is the API's own ring rather than a bounding box. The tiles are laid
    on a projected grid that is a fraction of a degree off north, so a tile is a rotated
    quadrilateral in lon/lat - drawing it as an axis-aligned box would tilt the whole
    field against the streets underneath it.

    Every temperature is optional because the upstream feature can carry a null. A tile
    that is missing the field being drawn is left undrawn; it is never filled with a
    neighbour's value, and it is never counted as a zero.
    """

    tile_id: str
    # closed [lon, lat] ring, degrees, first point repeated last
    ring_lonlat: list[list[float]]
    t_min_c: float | None = None
    t_mean_c: float | None = None
    t_max_c: float | None = None


class HeatmapResponse(BaseModel):
    """The measured temperature field a site-day's ambient was reduced from.

    This is the SPATIAL field, not a time series. A filter_type=3 heatmap carries one
    min/mean/max triple per tile for the whole day, so the axis here runs across the
    tiles of the AOI and never across hours.

    CACHED ONLY, and that is a money decision rather than a caching one: a site-day that
    is not on disk costs 4220 credits, and a map that fetched on open would empty the
    budget by being looked at. The one control allowed to spend is the location picker,
    which asks first and names the price.

    t_min_c / t_mean_c / t_max_c are the AOI reduction - the tile mean of each field,
    which is exactly the triple physics.season_analysis.build_ambient was handed. They
    are echoed here so the map can say which three numbers the solve actually used, the
    same way resolved_lat_deg is echoed by /api/ambient.
    """

    resolved_lat_deg: float
    resolved_lon_deg: float
    resolved_date: str
    coverage: str            # which US coverage box holds the point
    mode: str                # "archive" or "forecast"
    source: str = "cached"   # never "live": this route cannot spend
    credits_spent: int = 0
    granularity_m: int
    day_of_year: int
    t_min_c: float
    t_mean_c: float
    t_max_c: float
    n_tiles: int
    # [west, south, east, north] degrees, over every tile ring
    bbox_lonlat: list[float]
    tiles: list[HeatmapTile]
