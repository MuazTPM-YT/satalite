// Self-check for the basemap override. No backend, no browser:
//   npx tsx src/lib/test_basemap.ts
//
// The override exists because a tile provider can gate you overnight - CARTO did, mid
// build - and the fix should not require editing a component. What it must never do is
// half-apply: a deployment that names its own provider either gets that provider, or
// gets a built-in and a sentence saying why. Silently serving somebody's map without
// their attribution is the one outcome that is worse than not working, because
// attribution is a licence condition rather than a courtesy.

import {
    BASEMAPS,
    BASEMAP_IDS,
    DEFAULT_BASEMAP_ID,
    MAX_ZOOM,
    basemapFor,
    expandTemplate,
    readCustomBasemap,
} from "./basemap";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const CREDIT = "© OpenStreetMap contributors";

/* ── the template ───────────────────────────────────────────────────────────── */

console.log("template");

check(
    "z/x/y expands in order",
    expandTemplate("https://t.example/{z}/{x}/{y}.png", 14, 3090, 6574) ===
        "https://t.example/14/3090/6574.png",
);
// Esri orders its path z/y/x, and a provider that does the same must be expressible
// without a code change - that is the entire reason this takes a template.
check(
    "z/y/x expands in ITS order",
    expandTemplate("https://t.example/tile/{z}/{y}/{x}", 14, 3090, 6574) ===
        "https://t.example/tile/14/6574/3090",
);
check(
    "a placeholder used twice is replaced twice",
    expandTemplate("/{z}/{x}/{y}?v={z}", 5, 1, 2) === "/5/1/2?v=5",
);

/* ── configured correctly ───────────────────────────────────────────────────── */

console.log("accepted");

const good = readCustomBasemap("https://t.example/{z}/{x}/{y}.png", CREDIT);
check("a complete config is accepted", good.kind === "ok", good.kind);
if (good.kind === "ok") {
    check("it carries the attribution verbatim", good.basemap.attribution === CREDIT);
    check("it builds tile urls", good.basemap.url(14, 3090, 6574) === "https://t.example/14/3090/6574.png");
    check('it is labelled "Custom" by default', good.basemap.label === "Custom");
    check("and zooms as deep as the view does", good.basemap.maxNativeZoom === MAX_ZOOM);
    // no lettering layer: most third-party styles bake their names into one image, and
    // the map must not try to fetch a second one that does not exist.
    check("it declares no separate label layer", good.basemap.labels === undefined);
    // and nobody's map gets dimmed but ours
    check("it is not filtered", good.basemap.filter === undefined);
}

const named = readCustomBasemap("/tiles/{z}/{x}/{y}.png", CREDIT, "16", "Ordnance Survey");
check("a relative path is allowed, for a self-hosted store", named.kind === "ok", named.kind);
if (named.kind === "ok") {
    check("a stated label is used", named.basemap.label === "Ordnance Survey");
    check("a stated max zoom is used", named.basemap.maxNativeZoom === 16);
}

/* ── refused, with a reason ─────────────────────────────────────────────────── */

console.log("refused");

// THE one that matters. Attribution is the licence condition, so a source without it is
// refused outright rather than served - the deployment falls back to an attributed
// built-in instead of publishing an unattributed map.
for (const [name, credit] of [
    ["missing", undefined],
    ["empty", ""],
    ["only whitespace", "   "],
] as [string, string | undefined][]) {
    const r = readCustomBasemap("https://t.example/{z}/{x}/{y}.png", credit);
    check(
        `attribution ${name} is refused`,
        r.kind === "refused" && r.reason.includes("NEXT_PUBLIC_MAP_ATTRIBUTION"),
        r.kind,
    );
}

for (const [name, url] of [
    ["a base url with no placeholders", "https://t.example/tiles"],
    ["a template missing {y}", "https://t.example/{z}/{x}.png"],
    ["a template missing {z}", "https://t.example/{x}/{y}.png"],
] as [string, string][]) {
    const r = readCustomBasemap(url, CREDIT);
    check(`${name} is refused`, r.kind === "refused", r.kind);
    if (r.kind === "refused") {
        check(`  and the reason names the template`, r.reason.includes("template"));
    }
}

// It becomes an <img src>, so the scheme is checked at the boundary rather than trusted.
for (const url of ["javascript:alert(1)//{z}{x}{y}", "ftp://t.example/{z}/{x}/{y}", "t.example/{z}/{x}/{y}"]) {
    const r = readCustomBasemap(url, CREDIT);
    check(`"${url.slice(0, 22)}…" is refused`, r.kind === "refused", r.kind);
}

for (const bad of ["abc", "0", "99", "-4"]) {
    const r = readCustomBasemap("https://t.example/{z}/{x}/{y}", CREDIT, bad);
    check(`max zoom "${bad}" is refused`, r.kind === "refused", r.kind);
}

/* ── not configured at all ──────────────────────────────────────────────────── */

console.log("absent");

// An unset override is a normal state, not a fault. It must not warn, and it must not
// leave a half-built entry behind.
for (const [name, url] of [
    ["unset", undefined],
    ["empty", ""],
    ["only whitespace", "  "],
] as [string, string | undefined][]) {
    check(`${name} means no custom basemap`, readCustomBasemap(url, CREDIT).kind === "none");
}

/* ── what the studio offers ─────────────────────────────────────────────────── */

console.log("the offered set");

// This process has no NEXT_PUBLIC_MAP_TILE_URL, so the built-ins are what is on offer.
check("the three built-ins are present", ["dark", "light", "satellite"].every((id) => id in BASEMAPS));
check("with no override, none is added", BASEMAP_IDS.length === 3, BASEMAP_IDS.join(","));
check("and dark is the default", DEFAULT_BASEMAP_ID === "dark");
check("every basemap credits somebody", BASEMAP_IDS.every((id) => BASEMAPS[id].attribution.trim() !== ""));
check(
    "every basemap states how deep it really goes",
    BASEMAP_IDS.every((id) => BASEMAPS[id].maxNativeZoom >= 1 && BASEMAPS[id].maxNativeZoom <= MAX_ZOOM),
);
// An unknown id must not blank the map: the switcher can only offer BASEMAP_IDS, but a
// lookup that can return undefined is one stale value away from a white screen.
check("an unknown id falls back rather than vanishing", basemapFor("nope") === BASEMAPS.dark);

// The Esri path really is z/y/x. Getting it backwards gives a map that loads, looks like
// somewhere, and is not the place asked for - so it is pinned here, not just commented.
check(
    "the built-ins keep Esri's z/y/x order",
    BASEMAPS.dark.url(14, 3090, 6574).endsWith("/14/6574/3090"),
    BASEMAPS.dark.url(14, 3090, 6574),
);

console.log(failures === 0 ? "\nall basemap checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
