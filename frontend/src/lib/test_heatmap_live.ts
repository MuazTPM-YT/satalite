// The map, against a real backend. Needs it up:
//   npx tsx src/lib/test_heatmap_live.ts
//
// test_mercator.ts proves the projection against the slippy-map spec with no server in
// sight. This proves the other half: that the field the backend actually serves is the
// shape the map draws, that it agrees with the ambient the solve is built from, and
// that looking at it never costs a credit.

import { ApiError, buildAmbient, heatmap, simulate, type HeatmapResponse } from "./api";
import { DEMO_DATE, PRESETS } from "./location";
import { fitBounds, pointInRing, projection, type Viewport } from "./mercator";

const PHOENIX = PRESETS[0];
const VIEWPORT: Viewport = { w: 1200, h: 800 };
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

// signed area of a screen-space ring. Zero means the tile would paint nothing at all.
function area(pts: [number, number][]): number {
    let sum = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        sum += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    }
    return Math.abs(sum) / 2;
}

async function main() {
    console.log("the field");

    let field: HeatmapResponse;
    try {
        field = await heatmap(PHOENIX.lat, PHOENIX.lon, DEMO_DATE);
    } catch (err) {
        console.error(
            `\ncould not read the demo day's field: ${err instanceof Error ? err.message : String(err)}`,
        );
        console.error("is the backend up on the origin in .env.local?");
        process.exit(1);
    }

    check("it came off disk", field.source === "cached");
    check("and cost nothing", field.credits_spent === 0);
    check("there are tiles", field.n_tiles > 0 && field.tiles.length === field.n_tiles);
    check("the granularity is stated", field.granularity_m > 0);
    check("the day resolves to the one asked for", field.resolved_date === DEMO_DATE);

    check(
        "every ring is closed",
        field.tiles.every((t) => {
            const first = t.ring_lonlat[0];
            const last = t.ring_lonlat[t.ring_lonlat.length - 1];
            return t.ring_lonlat.length >= 4 && first[0] === last[0] && first[1] === last[1];
        }),
    );
    check(
        "every coordinate is a finite lon/lat",
        field.tiles.every((t) =>
            t.ring_lonlat.every(
                ([lon, lat]) =>
                    Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90,
            ),
        ),
    );

    const [west, south, east, north] = field.bbox_lonlat;
    check(
        "the bbox holds every corner of every tile",
        field.tiles.every((t) =>
            t.ring_lonlat.every(
                ([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north,
            ),
        ),
    );

    /* ── it agrees with what the solve was given ────────────────────────────── */

    console.log("agreement with the solve");

    const ambient = await buildAmbient({
        lat: PHOENIX.lat,
        lon: PHOENIX.lon,
        date: DEMO_DATE,
        duration_hours: 24,
    });
    check("the ambient day cost nothing either", ambient.credits_spent === 0);
    // THE point of showing the field beside the solve: both must describe the same day
    // with the same three numbers. Two reducers is how a map and a curve drift apart.
    check(
        "the map's reduction is the ambient's own triple",
        field.t_min_c === ambient.t_min_c &&
            field.t_mean_c === ambient.t_mean_c &&
            field.t_max_c === ambient.t_max_c,
        `${field.t_min_c}/${field.t_mean_c}/${field.t_max_c} vs ${ambient.t_min_c}/${ambient.t_mean_c}/${ambient.t_max_c}`,
    );
    check("and the same day of year", field.day_of_year === ambient.day_of_year);

    // The reduction is a mean across tiles, so it has to sit inside the spread it came
    // from. Outside it, the map would be showing a field the curve is not built on.
    const means = field.tiles.map((t) => t.t_mean_c).filter((v): v is number => v !== null);
    check(
        "the reduced mean lies inside the tile spread",
        field.t_mean_c >= Math.min(...means) - 1e-9 &&
            field.t_mean_c <= Math.max(...means) + 1e-9,
    );
    // and the day's own ordering survives it
    check("min ≤ mean ≤ max", field.t_min_c <= field.t_mean_c && field.t_mean_c <= field.t_max_c);
    check(
        "every tile orders its own three the same way",
        field.tiles.every(
            (t) =>
                t.t_min_c === null ||
                t.t_mean_c === null ||
                t.t_max_c === null ||
                (t.t_min_c <= t.t_mean_c && t.t_mean_c <= t.t_max_c),
        ),
    );

    /* ── it would actually draw ─────────────────────────────────────────────── */

    console.log("drawable");

    const view = fitBounds(field.bbox_lonlat, VIEWPORT, MIN_ZOOM, MAX_ZOOM);
    const proj = projection(view, VIEWPORT);
    const rings = field.tiles.map((t) => ({
        tile: t,
        pts: t.ring_lonlat.map(([lon, lat]) => proj.project(lon, lat)) as [number, number][],
    }));

    check(
        "the whole field lands inside the viewport when fitted",
        rings.every((r) =>
            r.pts.every(([x, y]) => x >= 0 && x <= VIEWPORT.w && y >= 0 && y <= VIEWPORT.h),
        ),
    );
    // A tile smaller than a pixel is a tile nobody can hover or read. At the fitted
    // zoom every one of them has to be a real quadrilateral on screen.
    const areas = rings.map((r) => area(r.pts));
    check(
        "every tile has real area at the fitted zoom",
        Math.min(...areas) > 1,
        `smallest ${Math.min(...areas).toFixed(2)} px²`,
    );
    // 100 m tiles on a rotated grid, so they should all be about the same size. A wildly
    // uneven set would mean a ring was read in the wrong coordinate order.
    check(
        "the tiles are all about the same size",
        Math.max(...areas) / Math.min(...areas) < 1.5,
        `${Math.min(...areas).toFixed(1)}..${Math.max(...areas).toFixed(1)} px²`,
    );

    // The hover has to resolve, and resolve to ONE tile. The centroid of each ring is
    // the strongest version of that: it is inside its own tile and no other.
    const sample = rings.filter((_, i) => i % 17 === 0);
    check(
        "each tile's centre hits itself and nothing else",
        sample.every((r) => {
            const cx = r.pts.reduce((a, p) => a + p[0], 0) / r.pts.length;
            const cy = r.pts.reduce((a, p) => a + p[1], 0) / r.pts.length;
            const hits = rings.filter((other) => pointInRing(cx, cy, other.pts));
            return hits.length === 1 && hits[0].tile.tile_id === r.tile.tile_id;
        }),
        `${sample.length} sampled`,
    );

    // The pour site is what the AOI is centred on, so the marker has to be on screen.
    const [px, py] = proj.project(field.resolved_lon_deg, field.resolved_lat_deg);
    check(
        "the pour marker is on screen",
        px >= 0 && px <= VIEWPORT.w && py >= 0 && py <= VIEWPORT.h,
        `${px.toFixed(0)}, ${py.toFixed(0)}`,
    );

    /* ── picking a point changes the physics ────────────────────────────────── */

    console.log("the picked cell reaches the cure");

    // The extremes of the real day, taken per field.
    //
    // Per field, and not by picking one "coldest tile": over this AOI the two do not
    // rank together. Tile 123 holds the day's lowest minimum AND a higher maximum than
    // tile 67, which holds the highest minimum - so a single ordering would be a claim
    // about the data that the data does not make. The night is set by t_min and the
    // afternoon by t_max, and each has to be checked against the tile that owns it.
    const has = (t: (typeof field.tiles)[number]) =>
        t.t_min_c !== null && t.t_max_c !== null;
    const usable = field.tiles.filter(has);
    const lowestMin = usable.reduce((a, b) => (a.t_min_c! <= b.t_min_c! ? a : b));
    const highestMin = usable.reduce((a, b) => (a.t_min_c! >= b.t_min_c! ? a : b));
    const lowestMax = usable.reduce((a, b) => (a.t_max_c! <= b.t_max_c! ? a : b));
    const highestMax = usable.reduce((a, b) => (a.t_max_c! >= b.t_max_c! ? a : b));

    const centre = (t: (typeof field.tiles)[number]): [number, number] => {
        const ring = t.ring_lonlat.slice(0, -1);
        return [
            ring.reduce((a, pnt) => a + pnt[1], 0) / ring.length,
            ring.reduce((a, pnt) => a + pnt[0], 0) / ring.length,
        ];
    };
    const curveFor = async (t: (typeof field.tiles)[number]) => {
        const [lat, lon] = centre(t);
        const response = await buildAmbient({
            lat, lon, date: DEMO_DATE, duration_hours: 24, reduce: "tile",
        });
        check(
            `tile ${t.tile_id} resolves to itself, with its own triple, for nothing`,
            response.reduction === "tile" &&
                response.tile_id === t.tile_id &&
                response.n_tiles === 1 &&
                response.t_min_c === t.t_min_c &&
                response.t_mean_c === t.t_mean_c &&
                response.t_max_c === t.t_max_c &&
                response.credits_spent === 0,
            `${response.reduction}/${response.tile_id}`,
        );
        return response;
    };

    const [coolNight, warmNight, coolDay, warmDay] = [
        await curveFor(lowestMin),
        await curveFor(highestMin),
        await curveFor(lowestMax),
        await curveFor(highestMax),
    ];

    // THE point of clicking the map. Two cells of one AOI, one day, and the curve the
    // solver is handed must actually differ - otherwise picking a spot is decoration.
    check(
        "two cells give two different ambient curves",
        coolNight.ambient.air_temp_c.some((v, i) => v !== warmNight.ambient.air_temp_c[i]),
        `${(highestMin.t_min_c! - lowestMin.t_min_c!).toFixed(2)} °C between them in daily minimum`,
    );
    // the tile's own minimum sets the night the pour cures through
    check(
        "the higher daily minimum gives the warmer night",
        Math.min(...warmNight.ambient.air_temp_c) > Math.min(...coolNight.ambient.air_temp_c),
        `${Math.min(...warmNight.ambient.air_temp_c).toFixed(3)} vs ${Math.min(...coolNight.ambient.air_temp_c).toFixed(3)}`,
    );
    // and its own maximum sets the afternoon the placement limit is read against
    check(
        "the higher daily maximum gives the hotter afternoon",
        Math.max(...warmDay.ambient.air_temp_c) > Math.max(...coolDay.ambient.air_temp_c),
        `${Math.max(...warmDay.ambient.air_temp_c).toFixed(3)} vs ${Math.max(...coolDay.ambient.air_temp_c).toFixed(3)}`,
    );
    // and none of these is the AOI mean the chip defaults to
    check(
        "a cell is not the AOI mean",
        [coolNight, warmNight, coolDay, warmDay].some((r) => r.t_mean_c !== field.t_mean_c),
    );

    // And the whole way through to the cure, which is what the reader is actually
    // looking at. Same element, same mix, same hour - only the cell changes.
    const element = {
        shape: "slab",
        dims_mm: { width: 3000, thickness: 300 },
        dx_m: 0.02,
        placement_temp_c: 30,
    };
    const cures = await Promise.all(
        [coolNight, warmNight].map((r) =>
            simulate({ element, ambient: r.ambient, duration_hours: 24 }),
        ),
    );
    check(
        "the picked cell moves the cure, not just the weather",
        cures[0].peak_core_temp_c !== cures[1].peak_core_temp_c,
        `peak_core ${cures[0].peak_core_temp_c.toFixed(3)} vs ${cures[1].peak_core_temp_c.toFixed(3)} °C`,
    );
    check(
        "and the warmer cell cures hotter",
        cures[1].peak_core_temp_c > cures[0].peak_core_temp_c,
        `peak_core ${cures[0].peak_core_temp_c.toFixed(3)} vs ${cures[1].peak_core_temp_c.toFixed(3)} °C`,
    );
    console.log(
        `       cells ${lowestMin.tile_id} and ${highestMin.tile_id}: ` +
            `${(highestMin.t_min_c! - lowestMin.t_min_c!).toFixed(2)} °C apart in daily minimum, ` +
            `${(cures[1].peak_core_temp_c - cures[0].peak_core_temp_c).toFixed(3)} °C apart in peak core`,
    );

    // A point inside the AOI's bounding box but outside every tile must SAY it fell back
    // rather than quietly reaching for a neighbour.
    const outside = await buildAmbient({
        lat: PHOENIX.lat - 0.05,
        lon: PHOENIX.lon - 0.05,
        date: DEMO_DATE,
        duration_hours: 24,
        reduce: "tile",
    });
    check(
        "a point outside every tile reports the fallback",
        outside.reduction === "aoi_mean" && outside.tile_id === null,
        `${outside.reduction}/${outside.tile_id}`,
    );
    check("and the fallback really is the AOI mean", outside.t_mean_c === field.t_mean_c);

    /* ── it cannot spend ────────────────────────────────────────────────────── */

    console.log("the money gate");

    // Denver: in coverage, not on disk. Opening a map must never buy a day.
    const denver = PRESETS.find((p) => p.id === "denver")!;
    try {
        await heatmap(denver.lat, denver.lon, DEMO_DATE);
        check("an uncached site-day is refused", false, "it returned a field instead");
    } catch (err) {
        const api = err instanceof ApiError ? err : null;
        check("an uncached site-day is refused", api?.status === 409, String(api?.status));
        check("and the refusal names the price", (api?.message ?? "").includes("4220"), api?.message);
    }

    // Dubai: outside coverage entirely, refused before the cache is even consulted.
    try {
        await heatmap(25.2, 55.27, DEMO_DATE);
        check("a point outside coverage is refused", false, "it returned a field instead");
    } catch (err) {
        const api = err instanceof ApiError ? err : null;
        check("a point outside coverage is refused", api?.status === 422, String(api?.status));
        check(
            "and says why",
            (api?.message ?? "").includes("United States only"),
            api?.message,
        );
    }

    console.log(
        failures === 0 ? "\nall heatmap live checks passed" : `\n${failures} check(s) FAILED`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

void main();
