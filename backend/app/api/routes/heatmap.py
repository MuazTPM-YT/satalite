"""The measured temperature field behind a site-day. Reads the cache, never the API.

The solve only ever sees three numbers from a day: the tile-mean min, mean and max that
physics.season_analysis.build_ambient shapes the diurnal curve from. The heatmap those
three were reduced from carries 221 tiles at 100 m, and the whole premise of the project
is that air temperature varies street by street - so this route hands the field back
whole, and the map draws the spread the reduction flattened.

IT CANNOT SPEND. A site-day that is not already on disk is refused with its price. The
location picker is the one control that is allowed to buy a day, because it asks first;
a map that fetched on open would cost 4220 credits every time somebody looked at it.
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from app.models import HeatmapResponse, HeatmapTile
from app.services.fg_client import tiles as fg_tiles
from app.services.location import (
    date_mode,
    is_day_cached,
    polygon_for,
    require_us,
)
from app.services.season import (
    CREDITS_PER_CALL,
    GRANULARITY_M,
    cached_day,
    day_record,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["heatmap"])

# lon/lat decimals kept on the wire. Six is about 0.1 m at this latitude, which is a
# thousandth of a 100 m tile - far finer than anything a map can resolve, and it halves
# a payload that is otherwise 17 significant figures per corner, 221 tiles over.
COORD_DP = 6


# one API feature, as the map wants it. Missing fields stay None rather than becoming 0.
def _tile(feature: dict[str, object]) -> HeatmapTile:
    props = feature["properties"]
    assert isinstance(props, dict)
    geometry = feature["geometry"]
    assert isinstance(geometry, dict)
    ring = geometry["coordinates"][0]

    def temp_c(field: str) -> float | None:
        value = props.get(field)
        return None if value is None else float(value)

    return HeatmapTile(
        tile_id=str(props["tile_id"]),
        ring_lonlat=[[round(float(lon), COORD_DP), round(float(lat), COORD_DP)]
                     for lon, lat in ring],
        t_min_c=temp_c("min_temperature"),
        t_mean_c=temp_c("average_temperature"),
        t_max_c=temp_c("max_temperature"),
    )


# the field for a site-day. 409 with the price when it is not on disk - never a fetch.
@router.get("/heatmap", response_model=HeatmapResponse)
async def heatmap(
    lat: float = Query(ge=-90.0, le=90.0),
    lon: float = Query(ge=-180.0, le=180.0),
    date: str = Query(description="ISO day, e.g. 2025-07-15"),
) -> HeatmapResponse:
    try:
        box = require_us(lat, lon)
        mode = date_mode(date)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    if not is_day_cached(lat, lon, date):
        raise HTTPException(
            status_code=409,
            detail=(
                f"{date} at ({lat:.4f}, {lon:.4f}) is not on disk, and this route never "
                f"buys a day - fetching one costs {CREDITS_PER_CALL} credits. Choose the "
                "site and day in the location control, which asks before it spends. Once "
                "that day is fetched its field is here for nothing."
            ),
        )

    polygon = polygon_for(lat, lon)
    payload = cached_day(polygon, date)
    features = fg_tiles(payload)
    tiles = [_tile(f) for f in features]

    # the same reduction the ambient was built from - one reducer, not two that can drift
    record = day_record(date, payload)

    lons = [lon_deg for tile in tiles for lon_deg, _ in tile.ring_lonlat]
    lats = [lat_deg for tile in tiles for _, lat_deg in tile.ring_lonlat]

    log.info("heatmap %s at (%.4f, %.4f): %d tiles, 0 credits", date, lat, lon, len(tiles))
    return HeatmapResponse(
        resolved_lat_deg=lat,
        resolved_lon_deg=lon,
        resolved_date=date,
        coverage=box.name,
        mode=mode,
        granularity_m=GRANULARITY_M,
        day_of_year=record["day_of_year"],
        t_min_c=record["t_min_c"],
        t_mean_c=record["t_mean_c"],
        t_max_c=record["t_max_c"],
        n_tiles=len(tiles),
        bbox_lonlat=[min(lons), min(lats), max(lons), max(lats)],
        tiles=tiles,
    )
