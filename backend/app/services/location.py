"""Where the pour is: US-only bounds, the preset sites, and what a day costs.

Three constraints shape everything here, and all three are the API's, not ours.

COVERAGE IS US-ONLY. FortyGuard answers for the United States. Coordinates outside it
come back as an error, so they are rejected here BEFORE a call is made - a judge typing
Dubai must get a sentence, not a stack trace out of the vendored client.

A DAY COSTS 4220 CREDITS. Flat, whatever the area or granularity. That is the whole
reason this module can say whether a site-day is already on disk without calling
anything: a picker that fetched on every selection would empty the budget on stage.

THE ARCHIVE STARTS 2021-01-01 AND THE FORECAST RUNS 12 HOURS. Anything outside that is
refused with the range named.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any, NamedTuple

from app.config import Settings, get_settings
from app.services.cache import is_cached
from app.services.season import (
    CACHE_NAME,
    CREDITS_PER_CALL,
    DOWNTOWN_PHOENIX,
    day_params,
)

# FortyGuard's archive floor, and how far its forecast reaches past now.
ARCHIVE_START = date(2021, 1, 1)
FORECAST_HORIZON_H = 12


class Box(NamedTuple):
    """One lat/lon rectangle of coverage."""

    name: str
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float

    def holds(self, lat: float, lon: float) -> bool:
        return (
            self.lat_min <= lat <= self.lat_max and self.lon_min <= lon <= self.lon_max
        )


# The Aleutians cross the antimeridian, so Alaska needs two boxes rather than one - a
# single box spanning -179 to +172 would also contain the whole Pacific.
US_BOXES = (
    Box("continental US", 24.396308, 49.384358, -125.0, -66.93457),
    Box("Alaska", 51.0, 71.5, -179.15, -129.0),
    Box("Alaska (Aleutians, east of the antimeridian)", 51.0, 53.5, 172.0, 180.0),
    Box("Hawaii", 18.86, 22.24, -160.25, -154.75),
)


class Preset(NamedTuple):
    """A named US site. lat drives the solar term, lon only names the place."""

    id: str
    label: str
    lat: float
    lon: float


# Phoenix first and deliberately: it is the only site with cached days, so it is the
# only one that costs nothing. The rest are ordinary US cities spread across latitude,
# because latitude is the parameter that actually changes the answer - declination,
# sunset hour angle and daylength all move with it.
PRESETS = (
    Preset("phoenix", "Phoenix, AZ", 33.45, -112.07),
    Preset("miami", "Miami, FL", 25.76, -80.19),
    Preset("houston", "Houston, TX", 29.76, -95.37),
    Preset("los_angeles", "Los Angeles, CA", 34.05, -118.24),
    Preset("denver", "Denver, CO", 39.74, -104.99),
    Preset("chicago", "Chicago, IL", 41.88, -87.63),
    Preset("seattle", "Seattle, WA", 47.61, -122.33),
    Preset("anchorage", "Anchorage, AK", 61.22, -149.90),
    Preset("honolulu", "Honolulu, HI", 21.31, -157.86),
)

PRESET_BY_ID = {p.id: p for p in PRESETS}

# Phoenix's cached polygon is the season AOI, fixed and part of the cache key. Every
# other site would need its own AOI and its own 4220 credits per day.
PHOENIX = PRESET_BY_ID["phoenix"]

# how close a request has to be to Phoenix to reuse the cached downtown AOI. The cached
# polygon is 1.7 x 1.5 km, so this is "the same city", not "the same block".
PHOENIX_TOLERANCE_DEG = 0.15


# which coverage box holds this point, or None if the API does not answer for it.
def coverage_box(lat: float, lon: float) -> Box | None:
    return next((box for box in US_BOXES if box.holds(lat, lon)), None)


# the point is inside FortyGuard's coverage. Raises with the reason, never a bare False.
def require_us(lat: float, lon: float) -> Box:
    box = coverage_box(lat, lon)
    if box is None:
        raise ValueError(
            f"({lat:.4f}, {lon:.4f}) is outside FortyGuard's coverage. The API answers "
            "for the United States only: the continental US, Alaska and Hawaii."
        )
    return box


# archive day, forecast day, or neither. The caller shows which mode is in play.
def date_mode(day: str, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    asked = date.fromisoformat(day)
    today = now.date()
    if asked < ARCHIVE_START:
        raise ValueError(
            f"{day} is before the archive starts. Coverage runs "
            f"{ARCHIVE_START.isoformat()} to {today.isoformat()}, plus a "
            f"{FORECAST_HORIZON_H} hour forecast."
        )
    horizon = (now + timedelta(hours=FORECAST_HORIZON_H)).date()
    if asked > horizon:
        raise ValueError(
            f"{day} is past the forecast horizon. The forecast reaches "
            f"{FORECAST_HORIZON_H} hours from now, so {horizon.isoformat()} is the "
            "last day available."
        )
    return "archive" if asked <= today else "forecast"


# is this Phoenix, close enough to reuse the cached downtown AOI?
def is_phoenix(lat: float, lon: float) -> bool:
    return (
        abs(lat - PHOENIX.lat) <= PHOENIX_TOLERANCE_DEG
        and abs(lon - PHOENIX.lon) <= PHOENIX_TOLERANCE_DEG
    )


# Half-width of a generated AOI, and therefore the grid its centres are snapped to.
#
# Sized to match the cached Phoenix polygon (about 1.7 x 1.5 km). Area does not change
# the price; it was chosen small so a whole season of cached responses stays committable.
AOI_HALF_DEG = 0.0067


# the AOI centre a point belongs to, snapped to a grid one AOI wide.
#
# WITHOUT this, every distinct coordinate is its own polygon, its own cache key and its
# own 4220 credits - so nudging a pour twenty metres down the street re-buys the day, and
# picking a spot on the map costs money every single click. Snapping means one grid cell
# is one purchased day, and every point inside it is then free forever.
#
# The consequence is honest and visible: the tiles a point resolves to cover the snapped
# cell, not a box centred on the point, so the marker can sit anywhere inside the field
# rather than in the middle of it. That was already true of the demo site, which sits in
# the corner of the season AOI.
def snap_to_aoi(value: float) -> float:
    step = AOI_HALF_DEG * 2
    return round(round(value / step) * step, 6)


# a small AOI centred on a point, in the same shape season.py's polygon uses.
#
# Latitude is not corrected for in the longitude half-width, which makes the box narrower
# in the far north - harmless, since the tiles inside it are what get read.
def aoi_polygon(lat: float, lon: float, half_deg: float = AOI_HALF_DEG) -> dict[str, Any]:
    west, east = lon - half_deg, lon + half_deg
    south, north = lat - half_deg, lat + half_deg
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [west, north],
                        [east, north],
                        [east, south],
                        [west, south],
                        [west, north],
                    ]],
                },
            }
        ],
    }


# the AOI a point resolves to. Phoenix reuses the season polygon so its cached days hit.
def polygon_for(lat: float, lon: float) -> dict[str, Any]:
    if is_phoenix(lat, lon):
        return DOWNTOWN_PHOENIX
    return aoi_polygon(snap_to_aoi(lat), snap_to_aoi(lon))


# is this site-day already on disk? NEVER calls the API - that is the entire point.
def is_day_cached(lat: float, lon: float, day: str, settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    params = day_params(polygon_for(lat, lon), day)
    return is_cached(settings.cache_dir, CACHE_NAME, params)


# what fetching this site-day would cost, in credits. Zero when it is already cached.
def credits_for(lat: float, lon: float, day: str, settings: Settings | None = None) -> int:
    return 0 if is_day_cached(lat, lon, day, settings) else CREDITS_PER_CALL
