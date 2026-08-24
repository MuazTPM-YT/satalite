// where the solve inputs come from.
//
// The weather is NOT invented here and it is not fetched live: /api/demo-ensemble ships
// a complete SimulationRequest that was actually solved, and its ambient series is real
// cached data. Reusing it costs no FortyGuard quota, is reproducible between runs, and
// every input the viewer draws can be pointed back at a response field.
import {
    demoEnsemble,
    pourWindows,
    seasonAnalysis,
    validation,
    simulate,
    type DemoEnsembleResponse,
    type PourWindowResult,
    type SeasonAnalysisResponse,
    type ValidationResponse,
    type SimulationRequest,
    type SimulationResult,
} from "@/lib/api";
import { frameRange } from "@/lib/probe";

// how thinly the field frames are sent. 1 h over a 72 h cure is 73 frames, about 4 MB
// on a 3 m x 300 mm slab at 10 mm. The backend always keeps frame 0, the last frame and
// the peak-core frame whatever this says.
export const FIELD_STRIDE_H = 1.0;

export interface LoadedRun {
    // the request that was solved, straight out of the artifact.
    request: SimulationRequest;
    result: SimulationResult;
    // kept so a panel can say which artifact the scenario came from and when it was built.
    demo: DemoEnsembleResponse;
}

/**
 * A request's identity, independent of key order.
 *
 * Two things compare requests: staleness (have the inputs moved off the run on
 * screen) and the ensemble band (is this still the scenario it was computed for).
 * Both used `JSON.stringify`, which is order-sensitive - so a request rebuilt from
 * the studio's own inputs compared unequal to the identical request the backend had
 * sent back, purely because pydantic serialises its fields in declaration order.
 * That made the band permanently disclaim a run it did in fact describe.
 */
export function requestKey(value: unknown): string {
    return JSON.stringify(value, (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(
                  Object.keys(v as Record<string, unknown>)
                      .sort()
                      .map((k) => [k, (v as Record<string, unknown>)[k]]),
              )
            : v,
    );
}

// the scenario artifact. The studio reads its AMBIENT series and solves whatever the
// input panel currently describes against it - the artifact is the weather, not the
// element, and every other field of the scenario is only there so a panel can say what
// the precomputed band was computed for.
export function demoScenario(): Promise<DemoEnsembleResponse> {
    return demoEnsemble();
}

// pull the demo scenario and solve it exactly as shipped. Used by the live self-checks,
// which have to compare against the artifact's own element rather than the UI's.
export async function loadDemoRun(): Promise<LoadedRun> {
    const demo = await demoEnsemble();
    const request = demo.scenario;
    const result = await simulate(request, { fields: true, fields_stride_h: FIELD_STRIDE_H });
    return { request, result, demo };
}

/** how many start hours the sweep tries. Each one is a full deterministic solve. */
export const N_CANDIDATES = 6;

/**
 * Candidate start offsets, spread across the room the series actually has.
 *
 * These used to be the literal [0, 4, 8, 12, 16, 20]: six hours picked because a
 * 96 h series minus a 72 h window leaves 24. Shorten the cure window and the sweep
 * kept testing the same 20 h while 60 h of weather sat unexamined; lengthen it past
 * 76 h and every candidate but the first ran off the end of the data, where the
 * backend has to hold the last hour flat - a made-up forecast wearing real data's
 * clothes.
 *
 * So the offsets come from the span. Whole hours, deduplicated, and never past
 * `span - duration`, which is the last start whose whole run is inside real weather.
 * A series with no room at all yields the single honest answer: start now.
 */
export function candidateOffsets(span_h: number, duration_h: number): number[] {
    const room = Math.floor(span_h - duration_h);
    if (!Number.isFinite(room) || room <= 0) return [0];
    const step = room / (N_CANDIDATES - 1);
    const out: number[] = [];
    for (let i = 0; i < N_CANDIDATES; i++) {
        const h = Math.round(i * step);
        if (out[out.length - 1] !== h) out.push(h);
    }
    return out;
}

// sweep the same element and weather across candidate start hours.
export function loadPourWindows(request: SimulationRequest): Promise<PourWindowResult> {
    const hours = request.ambient.hours_h;
    const span_h = hours.length > 1 ? hours[hours.length - 1] - hours[0] : 0;
    return pourWindows({
        element: request.element,
        mix: request.mix,
        ambient: request.ambient,
        candidate_offsets_h: candidateOffsets(span_h, request.duration_hours ?? span_h),
        duration_hours: request.duration_hours,
        t_ref_c: request.t_ref_c,
    });
}

// one colour scale for the whole run, so frames are comparable and 2D and 3D agree.
// Taken from the run's own extremes, widened to whole 5 degree steps - never a
// hardcoded 25-75 that could clip the very peak the viewer exists to show.
export function scaleBounds(
    result: SimulationResult,
    step_c = 5,
): { min_c: number; max_c: number } | null {
    if (!result.fields) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const frame of result.fields.temp_c) {
        const r = frameRange(frame);
        if (!r) continue;
        lo = Math.min(lo, r.min_c);
        hi = Math.max(hi, r.max_c);
    }
    if (lo === Infinity) return null;
    return {
        min_c: Math.floor(lo / step_c) * step_c,
        max_c: Math.ceil(hi / step_c) * step_c,
    };
}

// the precomputed season replay. available=false comes back at 200 and is a state, not
// an error, so this never throws for a missing artifact.
export function loadSeason(): Promise<SeasonAnalysisResponse> {
    return seasonAnalysis();
}

// the validation summary. 503 when the report has not been generated.
export function loadValidation(): Promise<ValidationResponse> {
    return validation();
}
