// Self-check for the map projection. No backend, no browser: run it with
//   npx tsx src/lib/test_mercator.ts
//
// The map draws two layers by two completely different mechanisms - DOM <img> tiles and
// a canvas - and they line up only because both come off the arithmetic in mercator.ts.
// A projection that is a few pixels out looks plausible and puts the heat next to the
// wrong street, so the checks below are against numbers that do not come from this
// implementation: the published EPSG:3857 tile indices for known cities.

import {
    TILE_PX,
    MAX_LAT_DEG,
    fitBounds,
    latToWorldY,
    lonToWorldX,
    panBy,
    pointInRing,
    projection,
    visibleTiles,
    worldXToLon,
    worldYToLat,
    zoomAbout,
    type MapView,
    type Viewport,
} from "./mercator";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

function near(a: number, b: number, tol: number): boolean {
    return Math.abs(a - b) <= tol;
}

const VIEWPORT: Viewport = { w: 900, h: 700 };

/* ── the projection itself ──────────────────────────────────────────────────── */

console.log("projection");

// Null Island sits at the exact centre of the world square.
check("0,0 is the centre of the world", near(lonToWorldX(0), 0.5, 1e-12) && near(latToWorldY(0), 0.5, 1e-12));

// The Mercator cut is where the world becomes square: y = 0 at the top.
check("the north cut is y=0", near(latToWorldY(MAX_LAT_DEG), 0, 1e-9), String(latToWorldY(MAX_LAT_DEG)));
check("beyond the cut is clamped, not infinite", Number.isFinite(latToWorldY(89.9)));

// Round trip. Degrees in, degrees out, to well under a metre.
for (const [lon, lat] of [
    [-112.07, 33.45], // Phoenix, the demo site
    [-149.9, 61.22], // Anchorage
    [-157.86, 21.31], // Honolulu
    [179.9, -45.0],
]) {
    const backLon = worldXToLon(lonToWorldX(lon));
    const backLat = worldYToLat(latToWorldY(lat));
    check(
        `round trip ${lon}, ${lat}`,
        near(backLon, lon, 1e-9) && near(backLat, lat, 1e-9),
        `${backLon}, ${backLat}`,
    );
}

// Tile indices from the OSM slippy-map spec's own formula, which states y through
// ln(tan(lat) + sec(lat)) - a different expression from the ln((1+sin)/(1-sin)) used in
// mercator.ts. They are algebraically the same projection, which is exactly why these
// make a check: the expected numbers were computed from the spec's form, not from ours.
for (const [name, lat, lon, z, x, y] of [
    ["Phoenix", 33.45, -112.07, 12, 772, 1643],
    ["Anchorage", 61.22, -149.9, 10, 85, 290],
    ["Honolulu", 21.31, -157.86, 14, 1007, 7198],
    ["Null Island", 0, 0, 1, 1, 1],
] as [string, number, number, number, number, number][]) {
    const n = Math.pow(2, z);
    const gotX = Math.floor(lonToWorldX(lon) * n);
    const gotY = Math.floor(latToWorldY(lat) * n);
    check(`${name} lands on tile ${z}/${x}/${y}`, gotX === x && gotY === y, `${z}/${gotX}/${gotY}`);
}

/* ── screen placement ───────────────────────────────────────────────────────── */

console.log("screen placement");

const view: MapView = { lon_deg: -112.07, lat_deg: 33.45, zoom: 14 };
const proj = projection(view, VIEWPORT);

const [centreX, centreY] = proj.project(view.lon_deg, view.lat_deg);
check(
    "the view centre projects to the middle of the viewport",
    near(centreX, VIEWPORT.w / 2, 1e-9) && near(centreY, VIEWPORT.h / 2, 1e-9),
);

const [rtLon, rtLat] = proj.unproject(137, 611);
const [rtX, rtY] = proj.project(rtLon, rtLat);
check("project/unproject round trip", near(rtX, 137, 1e-6) && near(rtY, 611, 1e-6));

// east is right and north is up. A map that has these backwards is a map of nowhere.
const [eastX] = proj.project(view.lon_deg + 0.01, view.lat_deg);
const [, northY] = proj.project(view.lon_deg, view.lat_deg + 0.01);
check("east is to the right", eastX > VIEWPORT.w / 2);
check("north is up", northY < VIEWPORT.h / 2);

// One zoom step doubles the pixels per degree, exactly.
const nearer = projection({ ...view, zoom: 15 }, VIEWPORT);
const spanAt14 = proj.project(view.lon_deg + 0.01, view.lat_deg)[0] - VIEWPORT.w / 2;
const spanAt15 = nearer.project(view.lon_deg + 0.01, view.lat_deg)[0] - VIEWPORT.w / 2;
check("a zoom step doubles the scale", near(spanAt15 / spanAt14, 2, 1e-9), String(spanAt15 / spanAt14));

/* ── tile cover ─────────────────────────────────────────────────────────────── */

console.log("tile cover");

const tiles = visibleTiles(view, VIEWPORT, 3, 19);
check("the viewport is covered", tiles.length > 0);
check(
    "every tile is on the grid",
    tiles.every((t) => t.x >= 0 && t.x < Math.pow(2, t.z) && t.y >= 0 && t.y < Math.pow(2, t.z)),
);
check(
    "the cover reaches every edge",
    Math.min(...tiles.map((t) => t.left)) <= 0 &&
        Math.min(...tiles.map((t) => t.top)) <= 0 &&
        Math.max(...tiles.map((t) => t.left + t.size)) >= VIEWPORT.w &&
        Math.max(...tiles.map((t) => t.top + t.size)) >= VIEWPORT.h,
);
check("no tile is requested twice", new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size === tiles.length);
check("at integer zoom a tile is drawn at its native size", near(tiles[0].size, TILE_PX, 1e-9));

// A tile's own top-left corner has to land where the projection says its lon/lat is,
// or the basemap and the field drift apart by a fraction of a tile per zoom step.
const t0 = tiles[0];
const n0 = Math.pow(2, t0.z);
const [tx, ty] = proj.project(worldXToLon(t0.x / n0), worldYToLat(t0.y / n0));
check("a tile corner sits where the projection puts it", near(tx, t0.left, 1e-6) && near(ty, t0.top, 1e-6));

// Overzoom: the view goes deeper than the tiles do.
//
// Every basemap runs out of imagery before the view runs out of zoom - Esri's Canvas
// services stop at 16 and then answer 200 with a blank placeholder for ever after. So the
// tile cover is asked for at the deepest level that really exists and scaled up, and the
// three things that must hold are that nothing deeper is requested, that the scale factor
// is exactly the shortfall, and that the viewport is still covered. Miss the last one and
// the map develops holes at high zoom instead of going soft.
const CAP = 16;
const deep = visibleTiles({ ...view, zoom: 19 }, VIEWPORT, 3, CAP);
check("nothing deeper than the cap is requested", deep.every((t) => t.z === CAP));
check(
    "and the shortfall becomes the scale factor",
    deep.every((t) => near(t.size, TILE_PX * Math.pow(2, 19 - CAP), 1e-9)),
    `${deep[0].size} px, expected ${TILE_PX * Math.pow(2, 19 - CAP)}`,
);
check(
    "the viewport is still covered at overzoom",
    Math.min(...deep.map((t) => t.left)) <= 0 &&
        Math.min(...deep.map((t) => t.top)) <= 0 &&
        Math.max(...deep.map((t) => t.left + t.size)) >= VIEWPORT.w &&
        Math.max(...deep.map((t) => t.top + t.size)) >= VIEWPORT.h,
);
// and an overzoomed tile still lands where the projection says its corner is, or the
// basemap slides out from under the field exactly when you have zoomed in to read it
const d0 = deep[0];
const dn = Math.pow(2, d0.z);
const deepProj = projection({ ...view, zoom: 19 }, VIEWPORT);
const [dx0, dy0] = deepProj.project(worldXToLon(d0.x / dn), worldYToLat(d0.y / dn));
check(
    "an overzoomed tile still registers with the field",
    near(dx0, d0.left, 1e-6) && near(dy0, d0.top, 1e-6),
);

// Panning across the antimeridian must still ask for real tiles.
const wrapped = visibleTiles({ lon_deg: 179.99, lat_deg: 0, zoom: 4 }, VIEWPORT, 3, 19);
check("columns wrap at the antimeridian", wrapped.every((t) => t.x >= 0 && t.x < Math.pow(2, t.z)));
check("wrapping still covers the viewport", wrapped.length > 0);

// Above the north cut there is no grid at all, and the rows must simply be absent.
const polar = visibleTiles({ lon_deg: 0, lat_deg: MAX_LAT_DEG, zoom: 3 }, VIEWPORT, 3, 19);
check("no tile row above the cut", polar.every((t) => t.y >= 0 && t.y < Math.pow(2, t.z)));

/* ── interaction ────────────────────────────────────────────────────────────── */

console.log("interaction");

// The whole reason zoomAbout exists: the point under the cursor must not move.
const anchor: [number, number] = [700, 180];
const before = projection(view, VIEWPORT).unproject(anchor[0], anchor[1]);
for (const step of [1, -1, 0.35, -2.5]) {
    const zoomed = zoomAbout(view, VIEWPORT, view.zoom + step, anchor, 3, 19);
    const [ax, ay] = projection(zoomed, VIEWPORT).project(before[0], before[1]);
    check(
        `zoom ${step > 0 ? "+" : ""}${step} holds the anchor`,
        near(ax, anchor[0], 1e-6) && near(ay, anchor[1], 1e-6),
        `${ax}, ${ay}`,
    );
}

check("zoom clamps at the top", zoomAbout(view, VIEWPORT, 99, anchor, 3, 19).zoom === 19);
check("zoom clamps at the bottom", zoomAbout(view, VIEWPORT, -99, anchor, 3, 19).zoom === 3);
check("a zoom that changes nothing returns the same view", zoomAbout(view, VIEWPORT, 14, anchor, 3, 19) === view);

// A drag moves the ground with the pointer, not against it.
const dragged = panBy(view, VIEWPORT, 120, -60);
const [dx, dy] = projection(dragged, VIEWPORT).project(view.lon_deg, view.lat_deg);
check(
    "a drag carries the map with the pointer",
    near(dx, VIEWPORT.w / 2 + 120, 1e-6) && near(dy, VIEWPORT.h / 2 - 60, 1e-6),
    `${dx}, ${dy}`,
);
check(
    "a drag past the pole stops at the cut",
    Math.abs(panBy({ lon_deg: 0, lat_deg: 84, zoom: 3 }, VIEWPORT, 0, 4000).lat_deg) <= MAX_LAT_DEG,
);

/* ── fitting the AOI ────────────────────────────────────────────────────────── */

console.log("fit");

// the real downtown Phoenix AOI, off the committed heatmap
const AOI: [number, number, number, number] = [-112.086542, 33.449911, -112.068218, 33.461538];
const fitted = fitBounds(AOI, VIEWPORT, 3, 19);
const fitProj = projection(fitted, VIEWPORT);
const [westX, southY] = fitProj.project(AOI[0], AOI[1]);
const [eastX2, northY2] = fitProj.project(AOI[2], AOI[3]);
check(
    "the whole AOI is on screen",
    westX >= 0 && eastX2 <= VIEWPORT.w && northY2 >= 0 && southY <= VIEWPORT.h,
    `${westX}..${eastX2}, ${northY2}..${southY}`,
);
check(
    "and it fills most of it",
    (eastX2 - westX) / VIEWPORT.w > 0.4 || (southY - northY2) / VIEWPORT.h > 0.4,
);
check(
    "the AOI centre is the view centre",
    near((westX + eastX2) / 2, VIEWPORT.w / 2, 1e-6) && near((northY2 + southY) / 2, VIEWPORT.h / 2, 1e-6),
);
check("a degenerate box does not produce an infinite zoom", Number.isFinite(
    fitBounds([-112.07, 33.45, -112.07, 33.45], VIEWPORT, 3, 19).zoom,
));

/* ── hit testing ────────────────────────────────────────────────────────────── */

console.log("hit test");

// a rotated quadrilateral, the way the API's tiles actually are
const ring = [
    [0, 0],
    [10, 1],
    [11, 11],
    [1, 10],
    [0, 0],
];
check("a point in the middle is inside", pointInRing(5.5, 5.5, ring));
check("a point beyond a corner is outside", pointInRing(-1, -1, ring) === false);
check("a point past a slanted edge is outside", pointInRing(10.9, 0.5, ring) === false);

// Neighbouring tiles share an edge. A point on it belongs to exactly one of them - not
// both, which flickers, and not neither, which leaves a dead seam under the pointer.
const left = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
];
const right = [
    [10, 0],
    [20, 0],
    [20, 10],
    [10, 10],
    [10, 0],
];
const onSeam = [pointInRing(10, 5, left), pointInRing(10, 5, right)];
check("a shared edge belongs to exactly one tile", onSeam.filter(Boolean).length === 1, String(onSeam));

console.log(failures === 0 ? "\nall mercator checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
