"""Pydantic schemas for the API boundary. Units live in field names."""

from datetime import datetime

from pydantic import BaseModel, Field


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


class PourGeometry(BaseModel):
    """2D cross-section of the pour. Stub - shape library lives in physics.geometry."""

    shape: str
    width_m: float
    height_m: float
    cell_size_m: float


class SimulationRequest(BaseModel):
    geometry: PourGeometry
    mix_id: str
    placement_temp_c: float
    ambient: TemperatureSeries
    duration_hours: float


class SimulationResult(BaseModel):
    times_h: list[float]
    peak_temp_c: float
    max_gradient_c: float
    equivalent_age_h: list[float]
    strength_fraction: list[float]
