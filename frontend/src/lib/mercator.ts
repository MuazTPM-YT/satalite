// Web Mercator, and the slippy-map arithmetic the heatmap view is drawn with.
//
// No map library. Every raster basemap on the web - OpenStreetMap, CARTO, Esri - is
// served as 256 px tiles on the same EPSG:3857 grid, and the whole projection is four
// lines of trigonometry. A library would bring its own renderer, its own CSS, its own
// imperative lifecycle to reconcile against React, and a megabyte of bundle, to do
// arithmetic that is already written down here and covered by test_mercator.ts.
//
// Normalised world coordinates throughout: x and y both run 0..1 across the whole
// world, so nothing in here has to know the zoom. A caller multiplies by the world size
// in pixels, which is what makes fractional zoom fall out for free.

/** side of one basemap tile, in css pixels. The grid every provider serves on. */
export const TILE_PX = 256;

/**
 * Latitude the projection stops at.
 *
 * Mercator sends the poles to infinity, so the tile grid is cut at the latitude that
 * makes the world exactly square: atan(sinh(pi)). Clamping here rather than at every
 * call site is what keeps a drag past the top edge from producing a non-finite y and
 * blanking the map.
 *
 * All the digits a double carries, not the five everyone quotes. Truncated, it is a
 * few nanodegrees SHORT of the cut, so worldYToLat(0) comes back larger than the
 * constant meant to bound it and a clamp against it reads as a failure.
 */
export const MAX_LAT_DEG = 85.0511287798066;

const DEG = Math.PI / 180;

/** longitude in degrees to normalised world x, 0 at the antimeridian, 1 back at it. */
export function lonToWorldX(lon_deg: number): number {
    return (lon_deg + 180) / 360;
}

/** latitude in degrees to normalised world y, 0 at the north cut, 1 at the south. */
export function latToWorldY(lat_deg: number): number {
    const lat = Math.max(-MAX_LAT_DEG, Math.min(MAX_LAT_DEG, lat_deg));
    const s = Math.sin(lat * DEG);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** normalised world x back to longitude. */
export function worldXToLon(x: number): number {
    return x * 360 - 180;
}

/** normalised world y back to latitude. */
export function worldYToLat(y: number): number {
    return (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) / DEG;
}

/** what the studio is looking at: a centre in degrees and a fractional zoom. */
export interface MapView {
    lon_deg: number;
    lat_deg: number;
    /** fractional. world size in css pixels is TILE_PX * 2^zoom. */
    zoom: number;
}

/** the viewport a view is projected into, in css pixels. */
export interface Viewport {
    w: number;
    h: number;
}

/**
 * The one projection both layers use.
 *
 * The basemap tiles are DOM images and the field is a canvas, so they are drawn by two
 * completely different mechanisms - and they line up only because both are placed from
 * this same object. Anything that computes its own screen position drifts by a pixel
 * per zoom step and the heat ends up beside the streets it belongs to.
 */
export interface Projection {
    /** world size in css pixels at this zoom */
    worldPx: number;
    /** [lon, lat] degrees to css pixels within the viewport */
    project: (lon_deg: number, lat_deg: number) => [number, number];
    /** css pixels back to [lon, lat] degrees */
    unproject: (x_px: number, y_px: number) => [number, number];
}

export function projection(view: MapView, viewport: Viewport): Projection {
    const worldPx = TILE_PX * Math.pow(2, view.zoom);
    const cx = lonToWorldX(view.lon_deg) * worldPx;
    const cy = latToWorldY(view.lat_deg) * worldPx;
    const ox = viewport.w / 2 - cx;
    const oy = viewport.h / 2 - cy;
    return {
        worldPx,
        project: (lon_deg, lat_deg) => [
            lonToWorldX(lon_deg) * worldPx + ox,
            latToWorldY(lat_deg) * worldPx + oy,
        ],
        unproject: (x_px, y_px) => [
            worldXToLon((x_px - ox) / worldPx),
            worldYToLat((y_px - oy) / worldPx),
        ],
    };
}

/** one basemap tile to fetch and where to put it. */
export interface TilePlacement {
    z: number;
    x: number;
    y: number;
    /** css pixels, top-left corner within the viewport */
    left: number;
    top: number;
    /** css pixels. Fractional zoom means this is not TILE_PX. */
    size: number;
}

/**
 * Every basemap tile that touches the viewport, at the integer zoom nearest the view.
 *
 * The integer zoom is ROUNDED, not floored: a tile drawn at 0.7x is soft, and rounding
 * keeps the scale factor within [0.71, 1.41] instead of [1, 2]. Rows outside the grid
 * are dropped, columns wrap - x is modulo 2^z so panning across the antimeridian shows
 * the map again rather than an empty band.
 */
export function visibleTiles(
    view: MapView,
    viewport: Viewport,
    minZoom: number,
    maxZoom: number,
): TilePlacement[] {
    const z = Math.max(minZoom, Math.min(maxZoom, Math.round(view.zoom)));
    const n = Math.pow(2, z);
    const { worldPx } = projection(view, viewport);
    const size = worldPx / n;
    // the viewport's own corners in normalised world coordinates
    const cx = lonToWorldX(view.lon_deg);
    const cy = latToWorldY(view.lat_deg);
    const halfW = viewport.w / 2 / worldPx;
    const halfH = viewport.h / 2 / worldPx;

    const x0 = Math.floor((cx - halfW) * n);
    const x1 = Math.floor((cx + halfW) * n);
    const y0 = Math.floor((cy - halfH) * n);
    const y1 = Math.floor((cy + halfH) * n);

    const out: TilePlacement[] = [];
    for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        for (let x = x0; x <= x1; x++) {
            out.push({
                z,
                x: ((x % n) + n) % n,
                y,
                left: (x / n - cx) * worldPx + viewport.w / 2,
                top: (y / n - cy) * worldPx + viewport.h / 2,
                size,
            });
        }
    }
    return out;
}

/**
 * The view that fits a [west, south, east, north] box into a viewport.
 *
 * `pad` is the fraction of the shorter side left as margin, so the AOI never runs
 * under the toolbar or the legend. A degenerate box - one tile, or a box measured
 * before the container had a size - falls back to the max zoom rather than returning
 * an infinite one.
 */
export function fitBounds(
    bbox_lonlat: [number, number, number, number],
    viewport: Viewport,
    minZoom: number,
    maxZoom: number,
    pad = 0.18,
): MapView {
    const [west, south, east, north] = bbox_lonlat;
    const x0 = lonToWorldX(west);
    const x1 = lonToWorldX(east);
    const y0 = latToWorldY(north);
    const y1 = latToWorldY(south);
    const spanX = Math.abs(x1 - x0);
    const spanY = Math.abs(y1 - y0);

    const usableW = Math.max(1, viewport.w * (1 - pad));
    const usableH = Math.max(1, viewport.h * (1 - pad));
    const worldPx = Math.min(
        spanX > 0 ? usableW / spanX : Infinity,
        spanY > 0 ? usableH / spanY : Infinity,
    );
    const zoom = Number.isFinite(worldPx)
        ? Math.log2(worldPx / TILE_PX)
        : maxZoom;

    return {
        lon_deg: worldXToLon((x0 + x1) / 2),
        lat_deg: worldYToLat((y0 + y1) / 2),
        zoom: Math.max(minZoom, Math.min(maxZoom, zoom)),
    };
}

/**
 * Zoom about a point, keeping whatever is under it under it.
 *
 * This is the difference between a map and a scaling rectangle: without it the wheel
 * pulls the point of interest off screen on every notch, and reaching a corner means
 * zoom, drag, zoom, drag.
 *
 * Done in normalised world coordinates rather than by unprojecting and reprojecting:
 * the world point under the cursor is fixed, so the new centre is that point minus the
 * cursor's offset from the middle at the NEW scale. One subtraction, and no round trip
 * through a latitude that would be clamped at the Mercator cut on the way.
 */
export function zoomAbout(
    view: MapView,
    viewport: Viewport,
    nextZoom: number,
    anchor_px: [number, number],
    minZoom: number,
    maxZoom: number,
): MapView {
    const zoom = Math.max(minZoom, Math.min(maxZoom, nextZoom));
    if (zoom === view.zoom) return view;

    const before = TILE_PX * Math.pow(2, view.zoom);
    const after = TILE_PX * Math.pow(2, zoom);
    const dx = anchor_px[0] - viewport.w / 2;
    const dy = anchor_px[1] - viewport.h / 2;

    // the world point under the cursor, which must not move
    const anchorX = lonToWorldX(view.lon_deg) + dx / before;
    const anchorY = latToWorldY(view.lat_deg) + dy / before;

    return {
        lon_deg: worldXToLon(anchorX - dx / after),
        lat_deg: worldYToLat(clamp01(anchorY - dy / after)),
        zoom,
    };
}

/** pan by a screen offset in css pixels. The drag moves the map, so the centre moves back. */
export function panBy(
    view: MapView,
    viewport: Viewport,
    dx_px: number,
    dy_px: number,
): MapView {
    const worldPx = TILE_PX * Math.pow(2, view.zoom);
    return {
        ...view,
        lon_deg: worldXToLon(lonToWorldX(view.lon_deg) - dx_px / worldPx),
        lat_deg: worldYToLat(clamp01(latToWorldY(view.lat_deg) - dy_px / worldPx)),
    };
}

// keep a normalised world y on the map. Past either end there is no tile grid at all.
function clamp01(y: number): number {
    return Math.max(0, Math.min(1, y));
}

/**
 * Is a point inside a closed ring? Ray casting.
 *
 * The tiles share edges, so a hover that resolves to two tiles at once or to none at a
 * seam shows up straight away as a flickering readout. `(yi > y) !== (yj > y)` counts an
 * edge only when the ray crosses its half-open span, which is what gives a shared edge
 * to exactly one of the two tiles that meet on it.
 */
export function pointInRing(x: number, y: number, ring: readonly (readonly number[])[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}
