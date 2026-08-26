// What the heatmap is drawn on top of, and how a deployment replaces it.
//
// This lives in its own file for one reason: the tile provider is the part of the map
// most likely to be changed by somebody who is not editing the rest of it. CARTO stamped
// API KEY REQUIRED across every tile it serves without a key, and the whole basemap had
// to be swapped inside a component of a thousand lines. It is a table and a few pure
// functions, so it belongs beside the other data modules, where test_basemap.ts can
// reach it.
//
// Nothing here renders. lib/mercator.ts decides WHERE a tile goes; this decides WHICH
// tile, and HeatMapView.tsx puts the two together.

/* ── zoom range ─────────────────────────────────────────────────────────────── */

// How far the VIEW may zoom, which is not how deep any one provider's tiles go - each
// basemap declares its own maxNativeZoom below, and past that the tiles are scaled up
// rather than requested. Below MIN a 100 m cell is smaller than a pixel; MAX is the
// deepest the best of the built-ins (imagery) really covers, and it wants to be
// reachable because clicking one cell to pour in is easier the closer you are to it.
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

/* ── what a basemap is ──────────────────────────────────────────────────────── */

export interface Basemap {
    /** what the switcher calls it */
    label: string;
    /** the cartography, drawn UNDER the field */
    url: (z: number, x: number, y: number) => string;
    /**
     * The lettering, drawn OVER the field so the map stays readable through it.
     *
     * Optional, because most third-party styles bake their labels into one image. The
     * Esri Canvas services publish them separately, which is what lets the heat sit
     * between the streets and their names instead of burying both.
     */
    labels?: (z: number, x: number, y: number) => string;
    /**
     * Verbatim from the service's own `?f=json` copyrightText.
     *
     * This is the licence condition, not a courtesy, so it is copied from the provider
     * rather than written from memory - which is exactly how it drifted before: World
     * Imagery credited "Maxar" here long after the service itself had moved to crediting
     * Vantor. Re-check with:
     *   curl -s "<service>/MapServer?f=json" | jq -r .copyrightText
     */
    attribution: string;
    /**
     * The deepest zoom this service actually holds imagery for.
     *
     * NOT the deepest the tiling scheme defines. All six Esri services below advertise
     * 24 levels of detail, and then answer 200 with a 2,521 byte blank placeholder past
     * the level they really cover. Measured over downtown Phoenix, tile bytes:
     *
     *     z    dark canvas   light canvas   world imagery
     *     16        10,025         12,364          24,124
     *     17         2,521          2,521          23,650
     *     18         2,521          2,521          20,810
     *     19         2,521          2,521          16,515
     *     20         2,521          2,521           2,521
     *
     * So the Canvas basemaps stop at 16 and the imagery at 19. Past the cap the tiles
     * below are scaled up instead of being requested, which is what keeps the map soft
     * rather than blank.
     */
    maxNativeZoom: number;
    /** what shows through where a tile has not loaded yet */
    ground: string;
    /**
     * A css filter on the BASE layer only.
     *
     * Esri's Dark Gray Canvas is a mid grey, several stops lighter than this app's
     * near-black ground, so the map panel read as a bright rectangle cut into the studio.
     * Knocking the base down settles it into the surrounding chrome and gives the cold
     * end of the ramp somewhere to be dark against. The lettering is its own layer and is
     * deliberately left alone, so street names stay legible through the field instead of
     * being dimmed along with the streets. Never applied to somebody else's custom map.
     */
    filter?: string;
}

/* ── the built-ins ──────────────────────────────────────────────────────────── */

/**
 * All Esri, all keyless, each with its labels as a second layer.
 *
 * This was CARTO's dark_all, and CARTO now stamps API KEY REQUIRED across every tile it
 * serves without one. A basemap whose licence can turn into a watermark on somebody
 * else's schedule is not a basemap you ship, so all three are ArcGIS Online services that
 * answer without a key - and they are one provider, so the three styles register the same
 * place the same way.
 *
 * Esri's tile path is z/y/x. Most providers are z/x/y, and getting it backwards produces
 * a map that loads, looks like somewhere, and is not the place that was asked for. This
 * is also why the override below takes a TEMPLATE rather than a base URL: the next
 * provider gets to state its own order.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

const BUILT_IN: Record<"dark" | "light" | "satellite", Basemap> = {
    dark: {
        label: "Dark",
        url: (z, x, y) => `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        labels: (z, x, y) =>
            `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
        attribution:
            "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community",
        maxNativeZoom: 16,
        ground: "#0f0f11",
        filter: "brightness(0.55) saturate(0.85)",
    },
    light: {
        label: "Light",
        url: (z, x, y) => `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        labels: (z, x, y) =>
            `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
        attribution:
            "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community",
        maxNativeZoom: 16,
        ground: "#d8d8d5",
    },
    satellite: {
        label: "Satellite",
        url: (z, x, y) => `${ESRI}/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        labels: (z, x, y) =>
            `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
        attribution: "Esri, Vantor, Earthstar Geographics, and the GIS user community",
        maxNativeZoom: 19,
        ground: "#12161c",
        // imagery is already dark and detailed; only enough to keep the ramp on top of it
        filter: "brightness(0.88)",
    },
};

/* ── the override ───────────────────────────────────────────────────────────── */

/** the fallback colour behind a custom map, seen only while its tiles are loading */
const CUSTOM_GROUND = "#0f0f11";
const CUSTOM_LABEL = "Custom";

/** a url template becomes a tile url. `{z}`, `{x}` and `{y}`, in whatever order. */
export function expandTemplate(template: string, z: number, x: number, y: number): string {
    return template
        .replaceAll("{z}", String(z))
        .replaceAll("{x}", String(x))
        .replaceAll("{y}", String(y));
}

/** a custom basemap, a reason it was refused, or null when none is configured. */
export type CustomBasemap =
    | { kind: "none" }
    | { kind: "ok"; basemap: Basemap }
    | { kind: "refused"; reason: string };

/**
 * Read a deployment's own tile source out of three strings.
 *
 * Takes its inputs as ARGUMENTS rather than reading the environment itself, which is the
 * only reason this is testable - Next inlines NEXT_PUBLIC_* at build time, so a module
 * that reached for process.env internally could only ever be checked by rebuilding.
 *
 * It refuses rather than half-applying, and every refusal carries a sentence. A custom
 * basemap that silently does not appear is a deploy problem somebody debugs at midnight;
 * a refusal naming the missing piece is one they fix in a minute.
 *
 * ATTRIBUTION IS REQUIRED, and that is not tidiness. Every tile provider worth using
 * makes attribution a licence condition, so a map served with none is a licence
 * violation. Refusing the whole basemap is the only safe failure: the deployment falls
 * back to a correctly attributed built-in instead of publishing an unattributed map.
 */
export function readCustomBasemap(
    url: string | undefined,
    attribution: string | undefined,
    maxNativeZoom?: string | undefined,
    label?: string | undefined,
): CustomBasemap {
    const template = (url ?? "").trim();
    if (template === "") return { kind: "none" };

    // It becomes an <img src>, so it is checked at the boundary rather than trusted.
    if (!/^(https?:\/\/|\/)/.test(template)) {
        return {
            kind: "refused",
            reason:
                `NEXT_PUBLIC_MAP_TILE_URL must start with https://, http:// or / — got "${template}".`,
        };
    }

    const missing = (["{z}", "{x}", "{y}"] as const).filter((k) => !template.includes(k));
    if (missing.length > 0) {
        return {
            kind: "refused",
            reason:
                `NEXT_PUBLIC_MAP_TILE_URL is missing ${missing.join(", ")}. It is a template, ` +
                "not a base url — for example https://tile.example.com/{z}/{x}/{y}.png " +
                "(some providers order it {z}/{y}/{x}).",
        };
    }

    const credit = (attribution ?? "").trim();
    if (credit === "") {
        return {
            kind: "refused",
            reason:
                "NEXT_PUBLIC_MAP_ATTRIBUTION is required whenever NEXT_PUBLIC_MAP_TILE_URL is " +
                "set. Attribution is a licence condition of every tile provider worth using, " +
                "so an unattributed basemap is refused rather than served.",
        };
    }

    let deepest = MAX_ZOOM;
    const asked = (maxNativeZoom ?? "").trim();
    if (asked !== "") {
        const parsed = Number(asked);
        if (!Number.isFinite(parsed) || parsed < MIN_ZOOM || parsed > 24) {
            return {
                kind: "refused",
                reason:
                    `NEXT_PUBLIC_MAP_MAX_ZOOM must be a number between ${MIN_ZOOM} and 24 — ` +
                    `got "${asked}".`,
            };
        }
        deepest = parsed;
    }

    return {
        kind: "ok",
        basemap: {
            label: (label ?? "").trim() || CUSTOM_LABEL,
            url: (z, x, y) => expandTemplate(template, z, x, y),
            attribution: credit,
            maxNativeZoom: deepest,
            ground: CUSTOM_GROUND,
        },
    };
}

/* ── what the studio actually offers ────────────────────────────────────────── */

// Read once, at module load. These MUST be spelled out rather than looked up by name:
// Next inlines NEXT_PUBLIC_* by static substitution, and process.env[someVariable] is
// left as a runtime lookup against an object that does not exist in the browser.
const CUSTOM = readCustomBasemap(
    process.env.NEXT_PUBLIC_MAP_TILE_URL,
    process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
    process.env.NEXT_PUBLIC_MAP_MAX_ZOOM,
    process.env.NEXT_PUBLIC_MAP_LABEL,
);

if (CUSTOM.kind === "refused") {
    // The deployment asked for something and did not get it, so it has to be told. The
    // built-ins still serve, so this degrades rather than breaking the view.
    console.warn(`[satalite] custom basemap refused: ${CUSTOM.reason}`);
}

export type BasemapId = string;

/**
 * Every basemap on offer, in switcher order.
 *
 * A configured custom source goes FIRST and becomes the default, because a deployment
 * that named its own provider meant to use it — leaving it as a fourth option nobody
 * clicks would make the setting look broken.
 */
export const BASEMAPS: Readonly<Record<BasemapId, Basemap>> =
    CUSTOM.kind === "ok" ? { custom: CUSTOM.basemap, ...BUILT_IN } : BUILT_IN;

export const BASEMAP_IDS: readonly BasemapId[] = Object.keys(BASEMAPS);

export const DEFAULT_BASEMAP_ID: BasemapId = CUSTOM.kind === "ok" ? "custom" : "dark";

/** the basemap for an id, never undefined - an unknown id falls back to the default. */
export function basemapFor(id: BasemapId): Basemap {
    return BASEMAPS[id] ?? BASEMAPS[DEFAULT_BASEMAP_ID];
}
