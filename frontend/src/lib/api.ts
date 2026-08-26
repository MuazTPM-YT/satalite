// typed client for the SatAlite backend.
//
// Every type here is hand-mirrored from backend/app/models/__init__.py. If a field is
// not in that file it is not in this one either - no convenience fields, no derived
// quantities, no renames. Unit suffixes (_c, _h, _m, _kg_m2_h) travel with the field
// name exactly as the backend spells them: stripping a unit on the way into the
// frontend is how a celsius number ends up in a fahrenheit box.

// backend origin. set NEXT_PUBLIC_API_URL in frontend/.env.local (NOT the repo-root
// .env - next only reads env files under the frontend directory, and it inlines this
// at BUILD time, so it must be set before `next build`).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export { API_URL };

// ---------------------------------------------------------------- errors

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        // the backend's own words, when it sent any. null when the body was unreadable.
        readonly detail: string | null = null,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

// one fastapi validation failure. `detail` is a list of these on a 422.
interface ValidationErrorItem {
    type: string;
    loc: (string | number)[];
    msg: string;
}

// pull the human sentence out of a fastapi error body. Two shapes reach us: a plain
// string from an explicit HTTPException, and a list of validation items when a pydantic
// model_validator rejected the request. on_ground=true is the second kind, and its
// message is the whole point of the 422 - a generic "request failed" would hide it.
function readDetail(body: unknown): string | null {
    if (body === null || typeof body !== "object") return null;
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (!Array.isArray(detail)) return null;
    const msgs = (detail as ValidationErrorItem[])
        .filter((item) => item && typeof item.msg === "string")
        // fastapi prefixes every model_validator message with "Value error, ". That is
        // framing, not content, and it reads as noise in a panel.
        .map((item) => item.msg.replace(/^Value error, /, ""));
    return msgs.length > 0 ? msgs.join(" ") : null;
}

// ---------------------------------------------------------------- transport

// typed fetch. throws on non-2xx so callers never read a half-broken body.
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
            // only on a request that actually HAS a body. Sending it on a GET makes the
            // request non-simple and costs a CORS preflight round trip on every read.
            ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...init?.headers,
        },
        cache: "no-store",
    });

    if (!res.ok) {
        const detail = readDetail(await res.json().catch(() => null));
        const method = init?.method ?? "GET";
        throw new ApiError(detail ?? `${method} ${path} -> ${res.status}`, res.status, detail);
    }
    return (await res.json()) as T;
}

// POST json and read the typed result.
function post<T>(path: string, body: unknown): Promise<T> {
    return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

// ---------------------------------------------------------------- requests

// the shapes physics.geometry.SHAPES accepts. Anything else is a 422 at the boundary.
export const SHAPES = [
    "slab",
    "wall",
    "rect_column",
    "circular_column",
    "beam",
    "t_section",
    "i_section",
    "l_section",
] as const;
export type Shape = (typeof SHAPES)[number];

export interface ElementSpec {
    shape: Shape | string;
    // keys depend on the shape - physics/geometry.outline() names them:
    //   slab: width, thickness           wall: thickness, height
    //   rect_column | beam: width, height        circular_column: diameter
    //   t_section | i_section: flange_width, flange_thickness, web_width, height
    //   l_section: width, height, leg_thickness
    dims_mm: Record<string, number>;
    dx_m?: number;
    placement_temp_c?: number;
    formwork?: string;
    // true is rejected with 422 in this build: a GROUND face carries zero flux, which
    // is an insulated base and biases the core HIGH.
    on_ground?: boolean;
    /**
     * How deep under the face a surface sensor is taken to sit, metres. Default 0.050.
     * A CHOICE that must match the governing spec, like t_ref_c - the cracking flag is
     * evaluated against this reading, not against the true free surface.
     */
    surface_probe_depth_m?: number;
    // [x, y] metres from the section origin. null/absent samples the section centroid.
    probe_xy_m?: [number, number] | null;
}

export interface MixSpec {
    mix_id?: string;
    cement_type?: string | null;
    // TOTAL cementitious content: cement + fly ash + any other SCM. The old wire name
    // was cement_kg_m3, which said the opposite of what it held.
    cementitious_kg_m3?: number | null;
    // Mix DESIGN. Sent WITH cementitious_kg_m3 and WITHOUT h_u/alpha_u/tau_h, these ask
    // the backend to derive the hydration parameters through the same Schindler-Folliard
    // regressions physics.season_analysis.standard_mix uses. fly_ash_frac is a
    // FRACTION 0-1, not the percentage the input box shows.
    w_cm?: number | null;
    fly_ash_frac?: number | null;
    // Fraction of total cementitious that is silica fume. Carried as MASS with NO heat -
    // Schindler-Folliard has no silica fume term. The studio has no input for it, so it
    // is always null here; it exists so this interface mirrors the backend's MixSpec.
    silica_fume_frac?: number | null;
    h_u_j_per_kg?: number | null;
    alpha_u?: number | null;
    tau_h?: number | null;
    beta?: number | null;
    grade?: string;
}

export interface AmbientSpec {
    hours_h: number[];
    air_temp_c: number[];
    // a FRACTION 0-1, not a percentage. the backend rejects percentages.
    rh_frac: number[];
    wind_ms: number[];
    // PERCENT 0-100, despite the upstream api calling it octas.
    cloud_pct: number[];
    ghi_w_m2: number[];
    sky_offset_c?: number;
}

export interface SimulationRequest {
    element: ElementSpec;
    mix?: MixSpec;
    ambient: AmbientSpec;
    duration_hours?: number;
    // maturity reference temperature. A CHOICE, not a constant - it must match the
    // strength calibration, and the response echoes back the one the run used.
    t_ref_c?: number;
}

export interface PourWindowRequest {
    element: ElementSpec;
    mix?: MixSpec;
    ambient: AmbientSpec;
    candidate_offsets_h: number[];
    duration_hours?: number;
    t_ref_c?: number;
    ensemble?: boolean;
    ensemble_samples?: number;
    seed?: number;
}

// ---------------------------------------------------------------- responses

export interface Health {
    status: string;
    version: string;
}

export interface Bands {
    p05: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
}

export interface EnsembleResult {
    n_samples: number;
    seed: number;
    dx_m: number;
    core_temp_c: Bands;
    surface_temp_c: Bands;
    strength_fraction: Bands;
    equivalent_age_h: Bands;
    strength_probability: number[];
    strip_time_h_p95: number | null;
    forecast_error: ForecastError;
}

// echoed so a caller can see whether the spread is measured skill or the provisional
// default. `provisional: true` means no paired forecast/observation data exists yet.
export interface ForecastError {
    lead_h: number[];
    bias_c: number[];
    sigma_c: number[];
    n_pairs: number[];
    provisional: boolean;
    source: string;
}

// which quantity crossed a limit: the nominal probe point, the hottest cell anywhere,
// both, or neither.
export type TrippedBy = "probe" | "max_anywhere" | "both" | "none";

export interface BreachFlags {
    def_risk: boolean;
    def_threshold_c: number;
    def_tripped_by: TrippedBy;
    cracking: boolean;
    cracking_limit_c: number;
    cracking_tripped_by: TrippedBy;
    evaporation: boolean;
    evaporation_limit_kg_m2_h: number;
    placement: boolean;
    placement_limit_c: number;
}

// per-cell temperature on the solver's own grid. Only present when the caller asked
// for it with ?fields=true - the full frame stack is tens of megabytes.
//
// Row 0 is the base and y increases upward. Cell (j, i) has its centre at
// ((i + 0.5) * dx_m, (j + 0.5) * dx_m). Only the FRAME axis is thinned by the stride;
// x and y arrive exactly as solved.
export interface FieldFrames {
    nx: number;
    ny: number;
    dx_m: number;
    // the subset of SimulationResult.times_h these frames were recorded at.
    times_h: number[];
    // indices into SimulationResult.times_h, so a frame lines up with the core/surface
    // series without matching floats.
    frame_indices: number[];
    // [frame][y][x] celsius. null OUTSIDE THE MASK - there is no concrete there, so
    // there is no temperature. Never draw it as a value.
    temp_c: (number | null)[][][];
}

export interface SimulationResult {
    times_h: number[];
    // sampled bilinearly at probe_xy_m, NOT the hottest cell.
    core_temp_c: number[];
    surface_temp_c: number[];
    // equivalent age in HOURS, weakest cell in the section.
    equivalent_age_h: number[];
    strength_fraction: number[];
    peak_core_temp_c: number;
    peak_core_time_h: number;
    max_core_surface_diff_c: number;
    // the same differential from the hottest point, not the probe. The conservative one.
    max_anywhere_surface_diff_c: number;
    // What a sensor at surface_probe_depth_m reads, and the two differentials measured
    // against it. THESE are what breaches.cracking fires on - ACI 301's limit is written
    // against an embedded thermocouple. The free-surface pair above is the upper bound.
    surface_probe_temp_c: number[];
    max_core_probe_diff_c: number;
    max_anywhere_probe_diff_c: number;
    surface_probe_depth_m: number;
    // hottest point anywhere in the section. The DEF-relevant number.
    max_core_temp_anywhere_c: number;
    // where peak_core_temp_c was actually sampled, [x, y] metres.
    probe_xy_m: [number, number];
    t_ref_c: number;
    peak_evaporation_kg_m2_h: number;
    // null means the strip fraction was never reached inside duration_hours.
    strip_time_h: number | null;
    breaches: BreachFlags;
    // the section polygon in metres, the same one the solver rasterised.
    outline_m: [number, number][];
    ensemble: EnsembleResult | null;
    // only present when the caller asked for it with ?fields=true.
    fields: FieldFrames | null;
}

export interface PourWindowCandidate {
    offset_h: number;
    placement_temp_c: number;
    peak_core_temp_c: number;
    max_core_temp_anywhere_c: number;
    max_core_surface_diff_c: number;
    max_anywhere_surface_diff_c: number;
    // the sensor-depth pair, which is what this row's cracking flag actually fired on.
    max_core_probe_diff_c: number;
    max_anywhere_probe_diff_c: number;
    peak_evaporation_kg_m2_h: number;
    strip_time_h: number | null;
    breaches: BreachFlags;
    n_breaches: number;
}

export interface PourWindowResult {
    candidates: PourWindowCandidate[];
    best_offset_h: number;
    ensemble: EnsembleResult | null;
}

export interface Site {
    label: string;
    lat_deg: number;
    lon_deg: number;
    date: string;
    placement_hour: number;
    // "cached" is a FortyGuard day on disk. "stated" means the daily min/mean/max were
    // written down rather than observed, and must never be shown as a measurement.
    source: "cached" | "stated" | string;
}

export interface DemoEnsembleResponse {
    // the scenario travels with the band on purpose: a band drawn beside a pour it was
    // not computed for is worse than no band at all.
    scenario: SimulationRequest;
    ensemble: EnsembleResult;
    // null for an artifact built before the field existed. The studio then shows no
    // location rather than inventing one.
    site: Site | null;
    built_at: string;
    sampler: string;
    dt_s: number;
    sampled_parameters: string[];
    // carries the MEASURED band-edge noise. Read the numbers out of this string; do not
    // restate them from anywhere else.
    note: string;
}

// `sampling`, `per_placement_hour`, `element`, `limits` and `assumptions` are typed
// `dict[str, Any]` in app/models, so the model does not pin their contents. The shapes
// below are read off the committed artifact (backend/data/cache/season-analysis.json),
// not invented - every member is optional so a regenerated artifact degrades instead of
// crashing the panel.
export interface SeasonSampling {
    n_days?: number;
    span_days?: number;
    consecutive?: boolean;
    stride_days?: number;
    coverage_pct?: number;
}

export interface SeasonHourStats {
    n_days?: number;
    pct_days_breaching_def?: number;
    pct_days_breaching_cracking?: number;
    pct_days_breaching_evaporation?: number;
    pct_days_breaching_placement?: number;
    mean_peak_core_temp_c?: number;
    mean_max_core_temp_anywhere_c?: number;
    mean_strip_time_h?: number;
    median_strip_time_h?: number;
    n_days_never_stripped?: number;
}

export interface SeasonLimits {
    def_c?: number;
    cracking_diff_c?: number;
    evaporation_kg_m2_h?: number;
    placement_c?: number;
    strip_fraction?: number;
}

export interface SeasonAssumptions {
    rh_frac?: number;
    wind_ms?: number;
    cloud_pct?: number;
    ghi_daylight_w_m2?: number;
    placement_above_ambient_c?: number;
    note?: string;
}

export interface SeasonAnalysisResponse {
    // false is a real STATE served at 200, not an error: a season costs real money to
    // fetch and an image can legitimately ship without one. `detail` says how to build it.
    available: boolean;
    detail: string | null;
    n_days: number | null;
    date_range: [string, string] | null;
    sampling: SeasonSampling | null;
    placement_hours: number[] | null;
    // keyed by placement hour as a STRING ("4", "14") - json object keys.
    per_placement_hour: Record<string, SeasonHourStats> | null;
    delta_14_minus_04: Record<string, number> | null;
    element: Record<string, unknown> | null;
    limits: SeasonLimits | null;
    assumptions: SeasonAssumptions | null;
}

// `cases` is `list[dict[str, Any]]` in app/models. Same rule as the season block: read
// off docs/VALIDATION.json, every member optional.
export interface ValidationCase {
    case_id?: string;
    name?: string;
    kind?: "adiabatic" | "field" | string;
    cement_type?: string;
    passed?: boolean;
    checks?: Record<string, boolean>;
    coverage?: {
        n_checkpoints?: number;
        n_inside?: number;
        pct_inside?: number;
        inside?: boolean[];
    };
    bands?: {
        quantity?: string;
        checkpoints_h?: number[];
        p05?: number[];
        p50?: number[];
        p95?: number[];
        peak_p05?: number;
        peak_p50?: number;
        peak_p95?: number;
        peak_width_c?: number;
        peak_covered?: boolean;
    };
    band_too_wide?: boolean;
    predicted?: Record<string, unknown>;
    // holds scalars, arrays and nulls: core_temp_c is a series, peak_time_window_h is a
    // [lo, hi] pair or null, peak_core_temp_c is a scalar.
    measured?: Record<string, unknown>;
    // scalars and per-checkpoint arrays alike
    errors?: Record<string, number | number[]>;
    notes?: string[];
}

export interface ValidationResponse {
    cases: ValidationCase[];
    generated_at: string | null;
    primary_metric: string;
    coverage_pass_pct: number | null;
    band_width_warn_c: number | null;
    n_samples: number | null;
    assumed_chemistry_ranges: Record<string, Record<string, [number, number]>>;
    notes: string[];
}

// ---------------------------------------------------------------- routes

// is backend alive
export function getHealth(): Promise<Health> {
    return apiFetch<Health>("/api/health");
}

// run one deterministic cure. bands are opt-in and cost a minute of solving.
export function simulate(
    request: SimulationRequest,
    opts: {
        ensemble?: boolean;
        samples?: number;
        seed?: number;
        fields?: boolean;
        fields_stride_h?: number;
    } = {},
): Promise<SimulationResult> {
    const q = new URLSearchParams();
    if (opts.ensemble) q.set("ensemble", "true");
    if (opts.samples !== undefined) q.set("samples", String(opts.samples));
    if (opts.seed !== undefined) q.set("seed", String(opts.seed));
    if (opts.fields) q.set("fields", "true");
    if (opts.fields_stride_h !== undefined) q.set("fields_stride_h", String(opts.fields_stride_h));
    const qs = q.toString();
    return post<SimulationResult>(`/api/simulate${qs ? `?${qs}` : ""}`, request);
}

// deterministic solve per candidate hour, ensemble on the pick if asked for.
export function pourWindows(request: PourWindowRequest): Promise<PourWindowResult> {
    return post<PourWindowResult>("/api/pour-windows", request);
}

// precomputed season replay. available=false at 200 is a state, not a failure.
export function seasonAnalysis(): Promise<SeasonAnalysisResponse> {
    return apiFetch<SeasonAnalysisResponse>("/api/season-analysis");
}

// precomputed bands for ONE fixed scenario. never solved live.
export function demoEnsemble(): Promise<DemoEnsembleResponse> {
    return apiFetch<DemoEnsembleResponse>("/api/demo-ensemble");
}

// validation summary against the USBR cases. 503 when the report has not been built.
export function validation(): Promise<ValidationResponse> {
    return apiFetch<ValidationResponse>("/api/validation");
}

// ---------------------------------------------------------------- location

export interface AmbientRequest {
    lat: number;
    lon: number;
    date: string;
    placement_hour?: number;
    duration_hours?: number;
    /** the money switch. false refuses an uncached day and reports its price instead. */
    allow_live?: boolean;
    /**
     * Which measured triple shapes the diurnal curve.
     *
     * "aoi_mean" (the default, and what every precomputed artifact was built with)
     * averages every tile in the AOI. "tile" uses the one tile the lat/lon falls in,
     * which is the hyperlocal answer and the whole point of picking a spot on the map.
     * A point outside every tile falls back to the mean, and the response says so.
     */
    reduce?: "aoi_mean" | "tile";
}

export interface AmbientResponse {
    ambient: AmbientSpec;
    // echoed the way t_ref_c and probe_xy_m are: the latitude that reached build_ambient.
    resolved_lat_deg: number;
    resolved_lon_deg: number;
    resolved_date: string;
    resolved_placement_hour: number;
    coverage: string;
    mode: "archive" | "forecast";
    source: "cached" | "live";
    credits_spent: number;
    // Which reducer produced the triple below, echoed rather than assumed. A request for
    // "tile" whose point fell outside every tile comes back "aoi_mean" with a null id.
    reduction: "aoi_mean" | "tile";
    tile_id: string | null;
    n_tiles: number;
    day_of_year: number;
    t_min_c: number;
    t_mean_c: number;
    t_max_c: number;
}

// what a site-day costs and whether it is in coverage. Never calls FortyGuard, so the
// picker can ask on every selection. Out of coverage is an ANSWER here, not an error.
export interface AmbientQuote {
    in_coverage: boolean;
    coverage?: string;
    mode?: "archive" | "forecast";
    cached?: boolean;
    credits?: number;
    /** why this site-day cannot be built, when it cannot. */
    reason?: string;
}

export function ambientQuote(lat: number, lon: number, date: string): Promise<AmbientQuote> {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), date });
    return apiFetch<AmbientQuote>(`/api/ambient/quote?${q.toString()}`);
}

// build the hourly ambient for a place and day. 409 when it is not cached and
// allow_live was not set - that refusal carries the credit price in its message.
export function buildAmbient(request: AmbientRequest): Promise<AmbientResponse> {
    return post<AmbientResponse>("/api/ambient", request);
}

// ---------------------------------------------------------------- heatmap

/** One FortyGuard tile: the ground it covers, and what the day did inside it. */
export interface HeatmapTile {
    tile_id: string;
    /** closed [lon, lat] ring, degrees. A rotated quadrilateral, not a bounding box. */
    ring_lonlat: [number, number][];
    // null when the upstream tile carries no value for that field. Never draw a null.
    t_min_c: number | null;
    t_mean_c: number | null;
    t_max_c: number | null;
}

/**
 * The measured temperature field a site-day's ambient was reduced from.
 *
 * SPATIAL, not temporal: one min/mean/max triple per tile for the whole day, so the
 * axis runs across the AOI and never across hours.
 *
 * t_min_c / t_mean_c / t_max_c are the AOI reduction - the tile mean of each field,
 * which is the exact triple the solve's ambient was built from.
 */
export interface HeatmapResponse {
    resolved_lat_deg: number;
    resolved_lon_deg: number;
    resolved_date: string;
    coverage: string;
    mode: "archive" | "forecast";
    source: "cached";
    credits_spent: number;
    granularity_m: number;
    day_of_year: number;
    t_min_c: number;
    t_mean_c: number;
    t_max_c: number;
    n_tiles: number;
    /** [west, south, east, north] degrees */
    bbox_lonlat: [number, number, number, number];
    tiles: HeatmapTile[];
}

/**
 * The measured field for a site-day. CACHED ONLY - it cannot spend a credit.
 *
 * 409 when the day is not on disk, and that refusal names the price. The location
 * picker is the one control allowed to buy a day; once it has, this is free forever.
 */
export function heatmap(lat: number, lon: number, date: string): Promise<HeatmapResponse> {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), date });
    return apiFetch<HeatmapResponse>(`/api/heatmap?${q.toString()}`);
}
