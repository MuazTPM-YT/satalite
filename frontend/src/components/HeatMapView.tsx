// The measured field, on the ground it was measured over.
//
// Every other view in the studio draws a SOLVE. This one draws the observation the
// solve was built from, and it exists because the reduction in between throws almost
// everything away: /api/ambient hands physics.season_analysis.build_ambient three
// numbers - the tile-mean min, mean and max of the day - and those three numbers are
// all the solver ever learns about a 2.5 km² city block sampled at 100 m. The premise
// of the whole project is that air temperature varies street by street. This is where
// that claim is either visible or it is not.
//
// IT CANNOT SPEND A CREDIT. /api/heatmap reads the cache and refuses anything else, so
// opening this view is free however many times it is opened. The location control is
// the one place in the app allowed to buy a day, and it asks first.
//
// No map library. The basemap is 256 px raster tiles on the standard EPSG:3857 grid,
// which is what every provider serves, and the projection is lib/mercator.ts - checked
// against the slippy-map spec's own worked numbers in lib/test_mercator.ts. A library
// here would mean a second renderer, a second lifecycle to reconcile against React and
// about a megabyte of bundle, to place images on a grid.
"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { Layers, Loader2, Locate, MapPin, Minus, Plus, Thermometer } from "lucide-react";
import {
    ApiError,
    ambientQuote,
    buildAmbient,
    heatmap,
    type AmbientResponse,
    type HeatmapResponse,
    type HeatmapTile,
} from "@/lib/api";
import {
    fitBounds,
    panBy,
    pointInRing,
    projection,
    visibleTiles,
    zoomAbout,
    type MapView,
    type TilePlacement,
    type Viewport,
} from "@/lib/mercator";
import { tempToColor } from "@/lib/thermalColormap";
import ThermalLegend from "@/components/ThermalLegend";
import { Segmented, Toolbar, ToolbarDivider, ToolbarToggle, cx } from "@/components/ui";
import {
    BASEMAPS,
    BASEMAP_IDS,
    DEFAULT_BASEMAP_ID,
    MAX_ZOOM,
    MIN_ZOOM,
    basemapFor,
    type BasemapId,
} from "@/lib/basemap";
import { CREDITS_PER_DAY } from "@/lib/location";
import type { ActiveLocation } from "@/components/LocationChip";

/* ── what the map can show ──────────────────────────────────────────────────── */

type Field = "min" | "mean" | "max";
type Scale = "stretch" | "absolute";

// Which of a tile's three numbers is on screen. All three ship in one call - the day is
// a filter_type=3 heatmap, which is per-tile min/mean/max together - so switching costs
// nothing and asks a genuinely different question of the same day.
const FIELDS: { id: Field; label: string }[] = [
    { id: "min", label: "Min" },
    { id: "mean", label: "Mean" },
    { id: "max", label: "Max" },
];

// What each field is, in the API's own terms. A filter_type=3 heatmap states one
// minimum, average and maximum PER TILE FOR THE DAY; it does not state the hour any of
// them occurred at, so neither does this.
const FIELD_NOTE: Record<Field, string> = {
    min: "The day's lowest in each tile — the night a fresh pour cures through.",
    mean: "The day's average in each tile. The ambient curve is centred on this.",
    max: "The day's highest in each tile — what the placement limit is read against.",
};

// A tile's own value for the field on screen. null stays null: a tile with no reading
// is left undrawn rather than filled with a zero or with a neighbour's number.
function tileValue_c(tile: HeatmapTile, field: Field): number | null {
    return field === "min" ? tile.t_min_c : field === "max" ? tile.t_max_c : tile.t_mean_c;
}

// how far one press of + or - moves the zoom. MIN_ZOOM and MAX_ZOOM live with the
// basemaps, because what is worth zooming to depends on what the tiles can show.
const ZOOM_STEP = 0.6;
// how far an arrow key pans, in css pixels
const KEY_PAN_PX = 90;

interface Props {
    /** where the pour is. The map follows it; it never chooses a day of its own. */
    location: ActiveLocation | null;
    /** the cure window on the inputs, so a picked point builds a long enough ambient */
    durationHours: number;
    /**
     * A new pour point, with the ambient already built for it.
     *
     * The same callback the location picker hands the studio, so a click on the map and
     * a city chosen in the chip arrive by one path: new weather in, request key changes,
     * the solve re-runs and every panel follows.
     */
    onApply: (response: AmbientResponse, label: string) => void;
}

/**
 * A pour point a click landed on, and how far it has got.
 *
 * A click inside a day that is already on disk applies straight away: it costs nothing,
 * and making the reader confirm a free action twice is how a control stops being used.
 * A click on ground whose day is NOT on disk is a 4220 credit purchase, so it stops here
 * and waits for a second, explicit press on a button that says the number - the same
 * rule, and the same wording, the location picker uses.
 */
interface Pick {
    lat: number;
    lon: number;
    /** the tile it landed in, when it landed in one. Null outside the measured AOI. */
    tile: HeatmapTile | null;
    /** null while the price is still being asked for */
    cached: boolean | null;
    credits: number;
    armed: boolean;
    busy: boolean;
    error: string | null;
}

/** what a request for one site-day came back with. Carries the key it answers. */
interface FieldResult {
    key: string;
    data: HeatmapResponse | null;
    error: { status: number | null; message: string } | null;
}

/**
 * The device pixel ratio, for the canvas backing store.
 *
 * Read the way a browser value is meant to be read rather than in an effect: the server
 * has none, so the server snapshot is 1 and the client corrects it on the first commit,
 * which keeps it out of a hydration mismatch. The subscription is a resolution media
 * query, so dragging the window to a different display re-sharpens the field.
 */
function useDevicePixelRatio(): number {
    return useSyncExternalStore(
        (onChange) => {
            const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            query.addEventListener("change", onChange);
            return () => query.removeEventListener("change", onChange);
        },
        () => window.devicePixelRatio,
        () => 1,
    );
}

export default function HeatMapView({ location, durationHours, onApply }: Props) {
    const [result, setResult] = useState<FieldResult | null>(null);

    const [field, setField] = useState<Field>("mean");
    const [scale, setScale] = useState<Scale>("stretch");
    const [basemapId, setBasemapId] = useState<BasemapId>(DEFAULT_BASEMAP_ID);
    const [opacity, setOpacity] = useState(0.8);

    const [view, setView] = useState<MapView | null>(null);
    const [viewport, setViewport] = useState<Viewport | null>(null);
    const [hovered, setHovered] = useState<HeatmapTile | null>(null);
    const [panning, setPanning] = useState(false);
    // The point a click landed on, while it is being priced or waiting for a confirm.
    // Null once it has been applied, or when nothing is pending.
    const [pick, setPick] = useState<Pick | null>(null);

    const boxRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // the drag in progress: where it started, and what the view was when it did
    const dragRef = useRef<{ x: number; y: number; view: MapView; moved: boolean } | null>(null);
    // Screen-space rings from the last paint, reused by the pointer for hit testing.
    // Re-projecting 221 tiles on every mousemove would be the one wasteful thing here.
    const paintedRef = useRef<{ tile: HeatmapTile; pts: [number, number][] }[]>([]);
    // The field is drawn here at full alpha and composited onto the map in one go.
    // Kept in a ref rather than allocated per paint: at 3200 x 2000 device pixels a
    // fresh canvas on every frame of a drag is the one thing here that would stutter.
    const layerRef = useRef<HTMLCanvasElement | null>(null);
    // Which site-day the current fit was made for. A new one refits; changing the field
    // or the basemap must NOT throw away a pan the reader has made.
    const fittedFor = useRef<string | null>(null);

    const basemap = basemapFor(basemapId);
    const dpr = useDevicePixelRatio();

    /* ── the field ──────────────────────────────────────────────────────────── */

    // The three numbers that identify the request, as deps in their own right - so the
    // fetch fires when the site-day changes and not when the location object is rebuilt
    // around the same site-day.
    const lat = location?.lat;
    const lon = location?.lon;
    const date = location?.date;
    const siteKey =
        lat !== undefined && lon !== undefined && date !== undefined
            ? `${lat},${lon},${date}`
            : null;

    // The answer carries the key it answers, the way the pour sweep and the location
    // quote do. Deriving "still loading" from a key mismatch rather than from a separate
    // flag means there is no moment where a stale field and a new site are both on
    // screen and both look current - and no state to set on the way into a fetch.
    useEffect(() => {
        if (siteKey === null || lat === undefined || lon === undefined || date === undefined) {
            return;
        }
        let live = true;
        heatmap(lat, lon, date)
            .then((response) => live && setResult({ key: siteKey, data: response, error: null }))
            .catch((err: unknown) => {
                if (!live) return;
                setResult({
                    key: siteKey,
                    data: null,
                    error:
                        err instanceof ApiError
                            ? { status: err.status, message: err.message }
                            : { status: null, message: String(err) },
                });
            });
        return () => {
            live = false;
        };
    }, [siteKey, lat, lon, date]);

    const answered = result !== null && result.key === siteKey ? result : null;
    const data = answered?.data ?? null;
    const error = answered?.error ?? null;
    const loading = siteKey !== null && answered === null;

    // A reading belongs to the site-day it was taken from. Adjusting during render is
    // React's documented way to react to changed state, and it is what the studio page
    // does with the probe for exactly the same reason: it avoids painting a temperature
    // from the previous map once before clearing it.
    const [hoverFrom, setHoverFrom] = useState<string | null>(null);
    if (siteKey !== hoverFrom) {
        setHoverFrom(siteKey);
        if (hovered !== null) setHovered(null);
    }

    /* ── the viewport ───────────────────────────────────────────────────────── */

    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const measure = () => {
            const r = el.getBoundingClientRect();
            const next = { w: Math.round(r.width), h: Math.round(r.height) };
            if (next.w === 0 || next.h === 0) return;
            setViewport((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const fit = useCallback(() => {
        if (!data || !viewport) return;
        setView(fitBounds(data.bbox_lonlat, viewport, MIN_ZOOM, MAX_ZOOM));
    }, [data, viewport]);

    // Open on the AOI, and refit only when the GROUND changes.
    //
    // Keyed on the bounding box rather than on the point, because picking a pour spot
    // moves the point without moving the AOI - and refitting there would yank the view
    // back to the whole square on every click, undoing the zoom the reader used to find
    // the spot in the first place. The field and the basemap do not refit either: those
    // are different questions about the same ground.
    useEffect(() => {
        if (!data || !viewport) return;
        const key = `${data.bbox_lonlat.join(",")}@${data.resolved_date}`;
        if (fittedFor.current === key && view !== null) return;
        fittedFor.current = key;
        setView(fitBounds(data.bbox_lonlat, viewport, MIN_ZOOM, MAX_ZOOM));
    }, [data, viewport, view]);

    /* ── colour bounds ──────────────────────────────────────────────────────── */

    // The two honest answers to "what does this colour mean", and they are very
    // different questions.
    //
    // ABSOLUTE spans all three fields of the day, so a colour means the same thing
    // whichever field is on screen and the min and max fields sit visibly apart. Over
    // one 2.5 km² AOI it also makes every tile of a single field nearly the same colour,
    // because that is the truth: the daily mean spreads about 0.1 °C across 221 tiles.
    //
    // STRETCH takes the selected field's own range, which is the only way the spatial
    // pattern is visible at all. It is the default, and it is why the legend prints two
    // decimals and the card states the span: a tenth of a degree painted across the full
    // ramp would otherwise read like a forty degree difference.
    const bounds = useMemo(() => {
        if (!data) return null;
        const all: number[] = [];
        const selected: number[] = [];
        for (const tile of data.tiles) {
            for (const v of [tile.t_min_c, tile.t_mean_c, tile.t_max_c]) {
                if (v !== null) all.push(v);
            }
            const v = tileValue_c(tile, field);
            if (v !== null) selected.push(v);
        }
        if (selected.length === 0 || all.length === 0) return null;

        const selMin = Math.min(...selected);
        const selMax = Math.max(...selected);
        let min_c = scale === "absolute" ? Math.min(...all) : selMin;
        let max_c = scale === "absolute" ? Math.max(...all) : selMax;
        // A field that reads identically everywhere would otherwise divide by zero and
        // paint the whole AOI at the cold end. Give it a hundredth of a degree of room.
        if (max_c - min_c < 1e-6) {
            min_c -= 0.005;
            max_c += 0.005;
        }
        return { min_c, max_c, selMin, selMax, span: selMax - selMin };
    }, [data, field, scale]);

    /* ── the paint ──────────────────────────────────────────────────────────── */

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !viewport) return;

        // backing store at the real device resolution, so the tile edges are crisp and
        // the canvas re-sizes if the window is dragged to a different display
        const w = Math.round(viewport.w * dpr);
        const h = Math.round(viewport.h * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewport.w, viewport.h);
        paintedRef.current = [];

        if (!data || !view || !bounds) return;
        const proj = projection(view, viewport);

        // The field goes onto its own layer at FULL alpha, and that layer is laid over
        // the basemap once.
        //
        // Painting the tiles straight onto the map at globalAlpha < 1 looked equivalent
        // and was not: the tiles tessellate, so each shared edge got its neighbour's
        // fill and then this tile's stroke composited over it, blending twice and
        // leaving a darker line. The result was a grid ruled across the data that was
        // entirely an artefact of the paint, at exactly the 100 m pitch that makes it
        // look like real structure.
        const layer = layerRef.current ?? (layerRef.current = document.createElement("canvas"));
        if (layer.width !== w || layer.height !== h) {
            layer.width = w;
            layer.height = h;
        }
        const lctx = layer.getContext("2d");
        if (!lctx) return;
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lctx.clearRect(0, 0, viewport.w, viewport.h);

        const trace = (target: CanvasRenderingContext2D, pts: [number, number][]) => {
            target.beginPath();
            target.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) target.lineTo(pts[i][0], pts[i][1]);
            target.closePath();
        };

        const painted: { tile: HeatmapTile; pts: [number, number][] }[] = [];
        for (const tile of data.tiles) {
            const pts = tile.ring_lonlat.map(([lonDeg, latDeg]) => proj.project(lonDeg, latDeg));
            painted.push({ tile, pts });

            const value_c = tileValue_c(tile, field);
            if (value_c === null) continue;

            const [r, g, b] = tempToColor(value_c, bounds.min_c, bounds.max_c);
            const css = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

            trace(lctx, pts);
            lctx.fillStyle = css;
            lctx.fill();
            // Stroke in the fill colour. Antialiasing along a shared edge otherwise
            // leaves a hairline of transparent canvas between two tiles that in fact
            // abut - the same false grid, arrived at from the other direction.
            lctx.strokeStyle = css;
            lctx.lineWidth = 1;
            lctx.stroke();
        }
        paintedRef.current = painted;

        ctx.globalAlpha = opacity;
        ctx.drawImage(layer, 0, 0, viewport.w, viewport.h);
        ctx.globalAlpha = 1;

        // The pointer's tile and the pour marker are annotation, not data, so they go on
        // at full strength above the composite - a marker that fades with the field
        // would be hardest to see exactly when the field is turned down to read the map.
        const hit = hovered ? painted.find((p) => p.tile.tile_id === hovered.tile_id) : undefined;
        if (hit) {
            trace(ctx, hit.pts);
            ctx.strokeStyle = "rgba(255,255,255,0.95)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // The cell the solve is actually running against, ringed.
        //
        // Only when the studio says the curve was built from one tile. Ringing it while
        // the run is on the AOI mean would claim a locality the numbers do not have.
        if (location?.reduction === "tile" && location.tileId) {
            const cell = painted.find((p) => p.tile.tile_id === location.tileId);
            if (cell) {
                trace(ctx, cell.pts);
                ctx.strokeStyle = "rgba(0,0,0,0.7)";
                ctx.lineWidth = 4;
                ctx.stroke();
                ctx.strokeStyle = "#6F9BFF";
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Where the pour actually is. The AOI is a box around it, and without the marker
        // nothing on screen says which point in that box the solve is for.
        const marker = (x: number, y: number, colour: string, hollow = false) => {
            if (x < -40 || x > viewport.w + 40 || y < -40 || y > viewport.h + 40) return;
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(0,0,0,0.65)";
            ctx.lineWidth = 3.5;
            ctx.stroke();
            ctx.strokeStyle = colour;
            ctx.lineWidth = 2;
            ctx.stroke();
            if (hollow) return;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fillStyle = colour;
            ctx.fill();
        };

        const [px, py] = proj.project(data.resolved_lon_deg, data.resolved_lat_deg);
        marker(px, py, "#6F9BFF");

        // A point that has been clicked but not yet paid for. Hollow and amber, the same
        // colour the rest of the studio uses for "this would spend credits", so it never
        // reads as the site the run is already using.
        if (pick) {
            const [qx, qy] = proj.project(pick.lon, pick.lat);
            marker(qx, qy, "#E0A33A", true);
        }
    }, [data, view, viewport, bounds, field, opacity, hovered, dpr, location, pick]);

    /* ── interaction ────────────────────────────────────────────────────────── */

    const localPoint = useCallback((clientX: number, clientY: number): [number, number] => {
        const rect = boxRef.current?.getBoundingClientRect();
        return rect ? [clientX - rect.left, clientY - rect.top] : [0, 0];
    }, []);

    const stepZoom = useCallback(
        (delta: number, anchor?: [number, number]) => {
            if (!viewport) return;
            setView((prev) =>
                prev
                    ? zoomAbout(
                          prev,
                          viewport,
                          prev.zoom + delta,
                          anchor ?? [viewport.w / 2, viewport.h / 2],
                          MIN_ZOOM,
                          MAX_ZOOM,
                      )
                    : prev,
            );
        },
        [viewport],
    );

    // Wheel zoom is bound natively rather than through onWheel.
    //
    // React attaches wheel listeners passively, and a passive listener cannot call
    // preventDefault - so the page scrolls, or the trackpad fires its back gesture, at
    // the same moment the map zooms. A non-passive listener is the documented way out.
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            // deltaMode 1 is lines and 2 is pages. A trackpad reports pixels; a mouse
            // wheel on Firefox reports lines, and treating three lines as three pixels
            // makes the wheel do very nearly nothing there.
            const perUnit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
            const delta = -e.deltaY * perUnit * 0.004;
            setView((prev) =>
                prev
                    ? zoomAbout(
                          prev,
                          { w: rect.width, h: rect.height },
                          prev.zoom + delta,
                          [e.clientX - rect.left, e.clientY - rect.top],
                          MIN_ZOOM,
                          MAX_ZOOM,
                      )
                    : prev,
            );
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !view) return;
        const [x, y] = localPoint(e.clientX, e.clientY);
        dragRef.current = { x, y, view, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const [x, y] = localPoint(e.clientX, e.clientY);
        const drag = dragRef.current;

        if (drag && viewport) {
            const dx = x - drag.x;
            const dy = y - drag.y;
            // a few pixels of slop, so a click that wobbles still reads as a click
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            if (!drag.moved) {
                drag.moved = true;
                setPanning(true);
                setHovered(null);
            }
            setView(panBy(drag.view, viewport, dx, dy));
            return;
        }

        const hit = paintedRef.current.find((p) => pointInRing(x, y, p.pts));
        setHovered((prev) =>
            (hit?.tile.tile_id ?? null) === (prev?.tile_id ?? null) ? prev : (hit?.tile ?? null),
        );
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        dragRef.current = null;
        setPanning(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        // A press that moved was a pan. Only a press that stayed put is a pick.
        if (drag && !drag.moved && view && viewport) {
            const [x, y] = localPoint(e.clientX, e.clientY);
            const [lon, lat] = projection(view, viewport).unproject(x, y);
            void choose(lat, lon);
        }
    };

    /* ── choosing where the pour is ─────────────────────────────────────────── */

    // Build the ambient for a point and hand it to the studio.
    //
    // reduce="tile" is the whole reason a click on the map means anything: the backend
    // then shapes the diurnal curve from the ONE 100 m tile the point sits in, instead
    // of the average of all 221. Over the demo AOI that is 0.37 °C of daily minimum
    // between tiles - real exposure that the mean flattens, and it lands in the cure.
    const applyPick = useCallback(
        async (next: Pick) => {
            if (!location) return;
            setPick({ ...next, busy: true, error: null });
            try {
                const response = await buildAmbient({
                    lat: next.lat,
                    lon: next.lon,
                    date: location.date,
                    placement_hour: location.placementHour,
                    duration_hours: durationHours,
                    allow_live: next.cached === false,
                    reduce: "tile",
                });
                // The PLACE, unchanged. A pick is always on a measured cell inside the
                // AOI the chip already names, so only the cell moved - and the cell is
                // named by the chip from tile_id, not spliced into the label here.
                // Splicing it appended a suffix per pick, so three picks read
                // "Phoenix, AZ · tile 114 · tile 114 · tile 16".
                onApply(response, location.label);
                setPick(null);
            } catch (err: unknown) {
                setPick({
                    ...next,
                    busy: false,
                    error: err instanceof ApiError ? err.message : String(err),
                });
            }
        },
        [location, durationHours, onApply],
    );

    // A click landed. Price it first - the quote never calls FortyGuard - then apply it
    // when it is free, or wait for a confirm when it is not.
    //
    // ONLY a click on a measured cell counts. Bare ground is not a refusal to be
    // explained, it is simply not a pick: a stray click on the margin would otherwise
    // spend six seconds of solver on a point nobody chose, and off the AOI there is no
    // heatmap to show for it either. Somewhere else entirely is what the location
    // control is for.
    const choose = useCallback(
        async (lat: number, lon: number) => {
            if (!location) return;
            const tile = data?.tiles.find((t) => pointInRing(lon, lat, t.ring_lonlat)) ?? null;
            if (!tile) {
                setPick(null);
                return;
            }
            const pending: Pick = {
                lat, lon, tile,
                cached: null,
                credits: CREDITS_PER_DAY,
                armed: false,
                busy: false,
                error: null,
            };
            setPick(pending);

            let quote;
            try {
                quote = await ambientQuote(lat, lon, location.date);
            } catch {
                setPick({ ...pending, error: "Could not price this point." });
                return;
            }
            if (quote.in_coverage === false || quote.reason) {
                setPick({ ...pending, error: quote.reason ?? "Outside coverage." });
                return;
            }
            const priced: Pick = {
                ...pending,
                cached: quote.cached === true,
                credits: quote.credits ?? CREDITS_PER_DAY,
            };
            // Free means free: apply it. Anything that costs waits for the button.
            if (priced.cached) await applyPick(priced);
            else setPick(priced);
        },
        [location, data, applyPick],
    );

    // The map is a control, so it works from the keyboard: arrows pan, +/- zoom, 0 fits.
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!viewport) return;
        const pan = (dx: number, dy: number) => {
            e.preventDefault();
            setView((prev) => (prev ? panBy(prev, viewport, dx, dy) : prev));
        };
        switch (e.key) {
            case "ArrowLeft":
                return pan(KEY_PAN_PX, 0);
            case "ArrowRight":
                return pan(-KEY_PAN_PX, 0);
            case "ArrowUp":
                return pan(0, KEY_PAN_PX);
            case "ArrowDown":
                return pan(0, -KEY_PAN_PX);
            case "+":
            case "=":
                e.preventDefault();
                return stepZoom(ZOOM_STEP);
            case "-":
            case "_":
                e.preventDefault();
                return stepZoom(-ZOOM_STEP);
            case "0":
                e.preventDefault();
                return fit();
        }
    };

    /* ── chrome ─────────────────────────────────────────────────────────────── */

    // Tiles are capped at what this basemap actually holds, while the view keeps its own
    // wider range. Past the cap visibleTiles keeps returning the deepest real level and
    // scales it up, so zooming in makes the streets soft instead of making them vanish.
    const tiles = view && viewport
        ? visibleTiles(view, viewport, MIN_ZOOM, basemap.maxNativeZoom)
        : [];
    const hoveredValue_c = hovered ? tileValue_c(hovered, field) : null;
    const idle = !data || loading || error !== null;

    return (
        <div
            ref={boxRef}
            className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
            style={{ background: basemap.ground }}
        >
            {/* basemap. DOM images rather than canvas draws: the browser then does the
                caching, the decoding and the progressive paint, and a tile that fails to
                load is one missing square rather than a broken frame. */}
            <TileLayer
                tiles={tiles}
                src={basemap.url}
                keyPrefix={`${basemapId}-base`}
                filter={basemap.filter}
            />

            {/* the field */}
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

            {/* The lettering, ABOVE the field. Street names are how a reader ties a hot
                cell to a place they know, and under an 80% field they are gone. Only the
                providers that publish labels separately have this layer; a style that
                bakes its names into one image simply has none to lift. */}
            {basemap.labels && (
                <TileLayer
                    tiles={tiles}
                    src={basemap.labels}
                    keyPrefix={`${basemapId}-labels`}
                />
            )}

            {/* The interaction surface, above both layers and below the chrome. A
                transparent sheet rather than handlers on the container: a pointerdown on
                a toolbar button would otherwise bubble down here and start a drag. */}
            <div
                role="application"
                aria-label="Measured air temperature over the pour site. Drag or arrow keys to pan, plus and minus to zoom, zero to fit."
                tabIndex={0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={() => setHovered(null)}
                onKeyDown={onKeyDown}
                className={cx(
                    "absolute inset-0 touch-none outline-none",
                    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue",
                    panning ? "cursor-grabbing" : "cursor-grab",
                )}
            />

            {/* attribution. A licence condition of all three sources, not a courtesy. */}
            <span className="pointer-events-none absolute bottom-1 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-white/70">
                {basemap.attribution}
            </span>

            {/* nothing to draw, and why */}
            {idle && (
                <div className="pointer-events-none absolute inset-0 flex cursor-default items-center justify-center p-8">
                    <Idle location={location} loading={loading} error={error} />
                </div>
            )}

            {data && bounds && (
                <>
                    {/* what is on screen, and what it was reduced to */}
                    <div className="pointer-events-none absolute left-3 top-3 max-w-[320px] cursor-default">
                        <FieldCard
                            data={data}
                            field={field}
                            scale={scale}
                            bounds={bounds}
                            location={location}
                            hovered={hovered}
                            hoveredValue_c={hoveredValue_c}
                            pick={pick}
                            onConfirm={() =>
                                pick && void applyPick({ ...pick, armed: true })
                            }
                            onCancel={() => setPick(null)}
                        />
                    </div>

                    {/* field, scale and opacity */}
                    <div className="absolute right-3 top-3 cursor-default">
                        <Toolbar>
                            <Thermometer
                                className="mx-1 h-3.5 w-3.5 shrink-0 text-text-muted"
                                strokeWidth={2}
                            />
                            <Segmented<Field>
                                value={field}
                                options={FIELDS}
                                onChange={setField}
                                label="Which per-tile temperature to draw"
                                size="sm"
                            />
                            <ToolbarDivider />
                            <Segmented<Scale>
                                value={scale}
                                options={[
                                    { id: "stretch", label: "Stretch" },
                                    { id: "absolute", label: "Absolute" },
                                ]}
                                onChange={setScale}
                                label="Colour scale: this field's range, or the whole day's"
                                size="sm"
                            />
                            <ToolbarDivider />
                            <label className="flex shrink-0 items-center gap-1.5 pl-0.5 pr-1">
                                <Layers
                                    className="h-3.5 w-3.5 shrink-0 text-text-muted"
                                    strokeWidth={2}
                                />
                                <input
                                    type="range"
                                    min={0.15}
                                    max={1}
                                    step={0.05}
                                    value={opacity}
                                    onChange={(e) => setOpacity(Number(e.target.value))}
                                    aria-label="Field opacity over the basemap"
                                    className="w-20 cursor-pointer accent-[var(--accent-blue)]"
                                />
                            </label>
                        </Toolbar>
                    </div>

                    {/* legend and navigation, right edge, where the other viewers keep them */}
                    <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 cursor-default flex-col items-end gap-2">
                        <ThermalLegend
                            min_c={bounds.min_c}
                            max_c={bounds.max_c}
                            caption={`°C ${field}`}
                            frameMin_c={bounds.selMin}
                            frameMax_c={bounds.selMax}
                        />
                        <Toolbar className="flex-col">
                            <ToolbarToggle
                                icon={Plus}
                                label="Zoom in"
                                onClick={() => stepZoom(ZOOM_STEP)}
                            />
                            <ToolbarToggle
                                icon={Minus}
                                label="Zoom out"
                                onClick={() => stepZoom(-ZOOM_STEP)}
                            />
                            <ToolbarToggle
                                icon={Locate}
                                label="Fit the measured area"
                                hint="Back to the measured AOI."
                                onClick={fit}
                            />
                        </Toolbar>
                    </div>
                </>
            )}

            {/* basemap, bottom centre — where a map keeps it */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 cursor-default">
                <Toolbar>
                    <Segmented<BasemapId>
                        value={basemapId}
                        options={BASEMAP_IDS.map((id) => ({
                            id,
                            label: BASEMAPS[id].label,
                        }))}
                        onChange={setBasemapId}
                        label="Basemap"
                        size="sm"
                    />
                </Toolbar>
            </div>
        </div>
    );
}

/* ── layers ─────────────────────────────────────────────────────────────────── */

/** One grid of raster tiles, placed from the projection. Basemap and lettering both. */
function TileLayer({
    tiles,
    src,
    keyPrefix,
    filter,
}: {
    tiles: TilePlacement[];
    src: (z: number, x: number, y: number) => string;
    keyPrefix: string;
    filter?: string;
}) {
    return (
        <div className="pointer-events-none absolute inset-0" style={{ filter }} aria-hidden="true">
            {tiles.map((t) => (
                // next/image would route these through the image optimiser, which is
                // exactly wrong for map tiles: they are already sized, already cached by
                // the CDN, and there are twenty new ones on every pan.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={`${keyPrefix}/${t.z}/${t.x}/${t.y}`}
                    src={src(t.z, t.x, t.y)}
                    alt=""
                    draggable={false}
                    onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                    }}
                    style={{
                        position: "absolute",
                        left: t.left,
                        top: t.top,
                        // a hair over, so neighbours overlap rather than leaving a seam
                        // of ground colour between them at fractional zoom
                        width: t.size + 1,
                        height: t.size + 1,
                    }}
                />
            ))}
        </div>
    );
}

/* ── the readout ────────────────────────────────────────────────────────────── */

function FieldCard({
    data,
    field,
    scale,
    bounds,
    location,
    hovered,
    hoveredValue_c,
    pick,
    onConfirm,
    onCancel,
}: {
    data: HeatmapResponse;
    field: Field;
    scale: Scale;
    bounds: { min_c: number; max_c: number; span: number };
    location: ActiveLocation | null;
    hovered: HeatmapTile | null;
    hoveredValue_c: number | null;
    pick: Pick | null;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    // Two decimals throughout. The spread across this AOI is tenths of a degree, and at
    // one decimal most of the tiles print the same number as each other.
    const c = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} °C`);

    // Is the run on screen built from one cell? Only then may this card show that cell's
    // numbers as the ones the solve is using.
    const cell =
        location?.reduction === "tile" && location.tileId
            ? (data.tiles.find((t) => t.tile_id === location.tileId) ?? null)
            : null;
    const onTile = cell !== null && location?.tileId != null;
    const solving_c: number[] = cell
        ? [cell.t_min_c ?? NaN, cell.t_mean_c ?? NaN, cell.t_max_c ?? NaN]
        : [data.t_min_c, data.t_mean_c, data.t_max_c];

    return (
        <div className="pointer-events-auto rounded-xl border border-hairline bg-bg-surface/90 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className="flex items-baseline gap-2">
                <MapPin
                    className="h-3.5 w-3.5 shrink-0 self-center text-accent-blue"
                    strokeWidth={2}
                />
                <span className="truncate text-[12px] font-semibold text-text-primary">
                    {location?.label ?? "Pour site"}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">
                    {data.resolved_date}
                </span>
            </div>

            <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-text-muted">
                {data.resolved_lat_deg.toFixed(4)}, {data.resolved_lon_deg.toFixed(4)} ·{" "}
                {data.n_tiles} tiles · {data.granularity_m} m · {data.mode} · 0 credits
            </p>

            {/* What the solver actually got, and from where. The curve is shaped by three
                numbers; the only question is whether they came from one cell or from all
                221, and the studio is never allowed to leave that ambiguous. */}
            <div className="mt-2 border-t border-border-default pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                    {onTile ? `Solving against tile ${location.tileId}` : "Solving against the AOI mean"}
                </p>
                <p className="mt-1 font-mono text-[11px] tabular-nums text-text-primary">
                    {solving_c.map((v) => v.toFixed(2)).join(" / ")}{" "}
                    <span className="text-text-muted">°C</span>
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-text-muted">
                    {onTile
                        ? "min / mean / max of that 100 m cell. The whole cure runs on these three."
                        : "min / mean / max across every tile. Click a cell to solve against that cell instead."}
                </p>
            </div>

            {/* how much variation that reduction flattened */}
            <div className="mt-2 border-t border-border-default pt-2">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-text-muted">{field} spread across the AOI</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-primary">
                        {bounds.span.toFixed(2)} °C
                    </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-text-muted">{FIELD_NOTE[field]}</p>
                <p className="mt-1 text-[10px] leading-snug text-text-muted">
                    {scale === "stretch"
                        ? `Ramp stretched over ${bounds.span.toFixed(2)} °C — colour shows where the heat sits, not how much. The legend prints the real numbers.`
                        : "Ramp spans the whole day, all three fields — one colour means one temperature everywhere."}
                </p>
            </div>

            {/* A point that has been clicked and would cost credits. Free picks never
                reach here - they are already applied by the time the card re-renders. */}
            {pick && (
                <div className="mt-2 rounded-lg border border-status-amber/40 bg-status-amber-dim p-2">
                    <p className="font-mono text-[10px] tabular-nums text-text-primary">
                        {pick.lat.toFixed(4)}, {pick.lon.toFixed(4)}
                    </p>
                    {pick.error ? (
                        <p className="mt-1 text-[10px] leading-snug text-status-red">{pick.error}</p>
                    ) : pick.cached === null ? (
                        <p className="mt-1 text-[10px] text-text-muted">Pricing this point…</p>
                    ) : (
                        <p className="mt-1 text-[10px] leading-snug text-text-secondary">
                            No heatmap on disk for {data.resolved_date} here. Solving this
                            point costs {pick.credits} credits.
                        </p>
                    )}
                    <div className="mt-1.5 flex gap-1.5">
                        {!pick.error && pick.cached === false && (
                            <button
                                type="button"
                                onClick={onConfirm}
                                disabled={pick.busy}
                                className={cx(
                                    "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md",
                                    "bg-status-amber text-[11px] font-semibold text-bg-primary",
                                    "disabled:opacity-40",
                                )}
                            >
                                {pick.busy ? (
                                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                                ) : null}
                                {pick.busy ? "Building" : `Pour here — spend ${pick.credits}`}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onCancel}
                            className={cx(
                                "h-7 rounded-md px-2 text-[11px] font-medium text-text-secondary",
                                "ring-1 ring-inset ring-hairline hover:bg-elevate-2",
                                pick.error || pick.cached !== false ? "flex-1" : "",
                            )}
                        >
                            {pick.error ? "Dismiss" : "Cancel"}
                        </button>
                    </div>
                </div>
            )}

            {/* the tile under the pointer */}
            <div className="mt-2 border-t border-border-default pt-2">
                {hovered ? (
                    <>
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] text-text-muted">tile {hovered.tile_id}</span>
                            <span className="shrink-0 font-mono text-[12px] tabular-nums text-text-primary">
                                {c(hoveredValue_c)}
                            </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] tabular-nums text-text-muted">
                            min {c(hovered.t_min_c)} · mean {c(hovered.t_mean_c)} · max{" "}
                            {c(hovered.t_max_c)}
                        </p>
                    </>
                ) : (
                    <p className="text-[10px] leading-snug text-text-muted">
                        Hover a cell for its min, mean and max. Click to pour there, then
                        press Solve to run the cure against it.
                    </p>
                )}
            </div>
        </div>
    );
}

/* ── nothing to draw ────────────────────────────────────────────────────────── */

function Idle({
    location,
    loading,
    error,
}: {
    location: ActiveLocation | null;
    loading: boolean;
    error: { status: number | null; message: string } | null;
}) {
    if (loading) {
        return (
            <div className="flex flex-col items-center gap-3">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-accent-blue" />
                <p className="rounded-lg bg-bg-surface/90 px-2 py-1 text-xs text-text-secondary backdrop-blur-xl">
                    Reading the measured field…
                </p>
            </div>
        );
    }

    if (error) {
        // 409 is the money gate, and it is a normal state rather than a fault: the day
        // has simply not been bought. Saying so plainly is the whole point of the route
        // refusing instead of fetching.
        const notCached = error.status === 409;
        return (
            <Card
                title={notCached ? "This day is not on disk" : "The field did not load"}
                tone={notCached ? "muted" : "red"}
            >
                {error.message}
                {notCached && (
                    <>
                        <br />
                        <br />
                        Opening this map never buys a day. Fetch it from the location
                        control, which names the price first — free from then on.
                    </>
                )}
            </Card>
        );
    }

    if (!location) {
        return (
            <Card title="No location yet">
                The map follows the pour site. Choose one in the location control.
            </Card>
        );
    }

    return (
        <Card title="No field">
            Nothing was returned for {location.date} at this site.
        </Card>
    );
}

function Card({
    title,
    tone = "muted",
    children,
}: {
    title: string;
    tone?: "muted" | "red";
    children: React.ReactNode;
}) {
    return (
        <div
            className={cx(
                "pointer-events-auto max-w-md rounded-xl border p-4 text-center backdrop-blur-xl",
                tone === "red"
                    ? "border-status-red/30 bg-status-red-dim"
                    : "border-border-default bg-bg-surface/90",
            )}
        >
            <p
                className={cx(
                    "text-sm font-medium",
                    tone === "red" ? "text-status-red" : "text-text-primary",
                )}
            >
                {title}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">{children}</p>
        </div>
    );
}
