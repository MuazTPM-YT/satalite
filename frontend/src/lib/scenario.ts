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

// pull the demo scenario, then solve it live with the per-cell field attached.
export async function loadDemoRun(): Promise<LoadedRun> {
    const demo = await demoEnsemble();
    const request = demo.scenario;
    const result = await simulate(request, { fields: true, fields_stride_h: FIELD_STRIDE_H });
    return { request, result, demo };
}

// candidate start offsets for the pour sweep, hours after the scenario's own start.
export const CANDIDATE_OFFSETS_H = [0, 4, 8, 12, 16, 20];

// sweep the same element and weather across candidate start hours.
export function loadPourWindows(request: SimulationRequest): Promise<PourWindowResult> {
    return pourWindows({
        element: request.element,
        mix: request.mix,
        ambient: request.ambient,
        candidate_offsets_h: CANDIDATE_OFFSETS_H,
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
