// The studio's input state, and the only place it turns into a request.
//
// Every field here reaches the solver. That is the rule this file exists to enforce:
// there is no "display-only" input on the panel any more, so an input that cannot be
// translated below does not get an input box above. `toSimulationRequest` is the whole
// contract, and it is a total function - the panel cannot construct a state that fails
// validation at the boundary.
import { SHAPES, type ElementSpec, type MixSpec, type SimulationRequest, type AmbientSpec } from "@/lib/api";
import { SHAPE_BY_ID, clampDims, type ShapeId } from "@/lib/shapes";

// UI label -> the formwork key physics.equations.boundary.FORMWORK_R is keyed by.
// The R values are the reason the labels read the way they do: an insulating blanket
// is 1.0 m²K/W, plywood 0.15, and steel is 0.0 - the same as no formwork at all.
export const FORMWORK_OPTIONS = [
  { id: "plywood_18mm", label: "Plywood 18 mm", note: "R 0.15 m²K/W" },
  { id: "steel", label: "Steel", note: "R 0.00 — no insulation" },
  { id: "insulating_blanket", label: "Insulating blanket", note: "R 1.00 m²K/W" },
  { id: "bare", label: "Bare / stripped", note: "R 0.00" },
] as const;

// ASTM C150 types the backend knows, with the cement heat each one picks.
// "unknown" is a real answer, not a missing one: it falls back to H_CEM_DEFAULT
// rather than guessing a type, and guessing low would relax every prediction.
export const CEMENT_OPTIONS = [
  { id: "", label: "Unknown", note: "500 J/g default" },
  { id: "I", label: "Type I", note: "510 J/g · highest C₃A" },
  { id: "II", label: "Type II", note: "500 J/g" },
  { id: "II/V", label: "Type II/V", note: "470 J/g · low C₃A" },
  { id: "V", label: "Type V", note: "450 J/g · lowest" },
] as const;

// Only the grades physics.strength_model.GRADE_PARAMS carries a fit for. 3000 psi is
// deliberately absent: offering it would send a request the backend answers with a 422,
// and a grade with no calibration has no strength curve to draw.
export const GRADE_OPTIONS = [
  { id: "4000psi", label: "4000 psi", note: "28 MPa" },
  { id: "5000psi", label: "5000 psi", note: "35 MPa" },
  { id: "6000psi", label: "6000 psi", note: "42 MPa" },
] as const;

/**
 * Where the hydration parameters come from.
 *
 * `standard` sends the mix the backend builds itself — every hydration field null,
 * which is exactly what the precomputed artifacts were solved with. `design` sends
 * the rows below and asks the backend to derive h_u, alpha_u and tau_h from them
 * through the same Schindler-Folliard regressions.
 *
 * This is a real choice, not a display toggle: it decides which of two different
 * requests goes on the wire, and it is the only way the studio can reproduce the
 * scenario the ensemble band was computed for.
 */
export const MIX_BASIS_OPTIONS = [
  { id: "standard", label: "Backend standard", note: "as the precomputed scenario" },
  { id: "design", label: "Mix design", note: "derived from the rows below" },
] as const;

// Solver grid pitch. Coarser is faster and blockier; this is the single biggest lever
// on how long a solve takes, so it is exposed rather than hidden at 10 mm.
export const GRID_OPTIONS = [
  { id: "0.005", label: "5 mm", note: "finest · slowest" },
  { id: "0.01", label: "10 mm", note: "default" },
  { id: "0.02", label: "20 mm", note: "fast preview" },
  { id: "0.025", label: "25 mm", note: "coarsest" },
] as const;

export interface ElementConfig {
  shape: ShapeId;
  /** which mix goes on the wire. See MIX_BASIS_OPTIONS. */
  mix_id: string;
  /** millimetre dims, keyed exactly as physics.geometry.outline reads them */
  dims_mm: Record<string, number>;
  /** view-only: the solver is 2D, so length extrudes the answer, it does not change it */
  length_mm: number;
  dx_m: number;
  formwork: string;
  placement_temp_c: number;
  /** "" means unknown, which the wire carries as null */
  cement_type: string;
  cement_kg_m3: number;
  wcm: number;
  fly_ash_pct: number;
  grade: string;
  /** hours of cure to solve. duration_hours on the wire. */
  cure_window_h: number;
  /** hours to slide the start of the run along the ambient series */
  start_offset_h: number;
  t_ref_c: number;
}

// default dims for a shape, straight off its own spec.
export function defaultDims(shape: ShapeId): Record<string, number> {
  return Object.fromEntries(SHAPE_BY_ID[shape].dims.map((d) => [d.key, d.default_mm]));
}

// The fallback, used only until the scenario artifact lands and `configFromRequest`
// replaces it. It is physics.season_analysis.STANDARD_ELEMENT: a 300 mm suspended
// slab. Nothing on screen is ever solved from these numbers - the studio's first
// solve waits for the artifact, so this exists to keep the panel from rendering
// against an empty object, not to describe any run.
export const DEFAULT_ELEMENT_CONFIG: ElementConfig = {
  shape: "slab",
  mix_id: "standard",
  dims_mm: defaultDims("slab"),
  length_mm: 6000,
  dx_m: 0.01,
  formwork: "plywood_18mm",
  placement_temp_c: 29,
  cement_type: "",
  cement_kg_m3: 400,
  wcm: 0.45,
  fly_ash_pct: 20,
  grade: "4000psi",
  cure_window_h: 72,
  start_offset_h: 0,
  t_ref_c: 20,
};

// config in, the element half of the request out. Dims are clamped on the way through,
// so a slider caught mid-drag can never send a self-intersecting section.
export function toElementSpec(c: ElementConfig): ElementSpec {
  return {
    shape: c.shape,
    dims_mm: clampDims(c.shape, c.dims_mm),
    dx_m: c.dx_m,
    placement_temp_c: c.placement_temp_c,
    formwork: c.formwork,
    // on_ground is rejected with a 422 in this build: a GROUND face carries zero flux,
    // which is an insulated base and biases the core HIGH. Not offered as an input.
    on_ground: false,
    probe_xy_m: null,
  };
}

// config in, the mix half out.
//
// Sending cement_kg_m3 with w_cm and fly_ash_frac asks the backend to derive h_u,
// alpha_u and tau_h through the same Schindler-Folliard regressions standard_mix()
// uses. Deriving them here instead would mean a second copy of the hydration
// equations living in TypeScript, which is exactly the drift this project forbids.
export function toMixSpec(c: ElementConfig): MixSpec {
  // Every field of MixSpec, explicitly, in both branches. A null and a missing key mean
  // the same thing to the backend, but they do NOT stringify the same - and the studio
  // compares its request against the scenario the ensemble band was solved for.
  const base = {
    mix_id: c.mix_id,
    cement_type: null as string | null,
    cement_kg_m3: null as number | null,
    w_cm: null as number | null,
    fly_ash_frac: null as number | null,
    h_u_j_per_kg: null,
    alpha_u: null,
    tau_h: null,
    beta: null,
    grade: c.grade,
  };
  // The backend's own mix. Every hydration field null, so app/services/simulate builds
  // it from the same defaults the offline artifacts were solved with - which is the
  // only request shape that can reproduce them.
  if (c.mix_id !== "design") return base;
  return {
    ...base,
    mix_id: "design",
    cement_type: c.cement_type === "" ? null : c.cement_type,
    cement_kg_m3: c.cement_kg_m3,
    w_cm: c.wcm,
    fly_ash_frac: c.fly_ash_pct / 100,
  };
}

/** Is `id` one of the shapes the solver rasterises? */
function isShapeId(id: string): id is ShapeId {
  return (SHAPES as readonly string[]).includes(id);
}

/**
 * The studio's inputs, read back OFF a request the backend actually solved.
 *
 * This is what the studio opens on. The alternative was a hand-copied constant per
 * field — a 300 mm slab at 29 °C, typed here because that is what the artifact
 * happened to contain when it was written. Regenerating the artifact then left the
 * studio opening on an element nobody had solved, silently, with no test that could
 * catch it.
 *
 * Anything the request does not carry falls back to `base`. `length_mm` never comes
 * from a request at all - the solver is 2D, so length is a view parameter and no
 * response has an opinion about it.
 */
export function configFromRequest(
  request: SimulationRequest,
  base: ElementConfig = DEFAULT_ELEMENT_CONFIG,
): ElementConfig {
  const el = request.element;
  const mix = request.mix ?? {};
  const shape = typeof el.shape === "string" && isShapeId(el.shape) ? el.shape : base.shape;

  // rebuilt in the SHAPE's own key order rather than the request's, so two requests
  // that name the same dimensions in a different order produce one config.
  const dims_mm = Object.fromEntries(
    SHAPE_BY_ID[shape].dims.map((d) => [d.key, el.dims_mm?.[d.key] ?? d.default_mm]),
  );

  const design = mix.mix_id === "design";
  return {
    ...base,
    shape,
    dims_mm: clampDims(shape, dims_mm),
    mix_id: mix.mix_id ?? base.mix_id,
    dx_m: el.dx_m ?? base.dx_m,
    formwork: el.formwork ?? base.formwork,
    placement_temp_c: el.placement_temp_c ?? base.placement_temp_c,
    cement_type: mix.cement_type ?? "",
    cement_kg_m3: mix.cement_kg_m3 ?? base.cement_kg_m3,
    // A design request carries these; a standard one does not, and reading a null
    // back as 0 would open the studio on a w/cm of zero.
    wcm: (design ? mix.w_cm : null) ?? base.wcm,
    fly_ash_pct: design && mix.fly_ash_frac != null ? mix.fly_ash_frac * 100 : base.fly_ash_pct,
    grade: mix.grade ?? base.grade,
    cure_window_h: request.duration_hours ?? base.cure_window_h,
    start_offset_h: 0,
    t_ref_c: request.t_ref_c ?? base.t_ref_c,
  };
}

/**
 * The whole request.
 *
 * The ambient series is NOT invented here and it is not fetched live: it is the one
 * that travelled with /api/demo-ensemble, which is real cached FortyGuard data that
 * was actually solved. `start_offset_h` slides the run along it, which is precisely
 * what /api/pour-windows does to compare start hours.
 */
export function toSimulationRequest(c: ElementConfig, ambient: AmbientSpec): SimulationRequest {
  // Clamped against what the series can actually cover. The panel bounds the slider
  // the same way, but the bound moves when the cure window grows - and an offset left
  // over from a shorter window would read the last hour of weather flat for the rest
  // of the run, which is a made-up forecast wearing real data's clothes.
  const span_h = ambient.hours_h[ambient.hours_h.length - 1] - ambient.hours_h[0];
  const offset = Math.min(Math.max(c.start_offset_h, 0), Math.max(0, span_h - c.cure_window_h));
  return {
    element: toElementSpec(c),
    mix: toMixSpec(c),
    ambient:
      offset === 0
        ? ambient
        : { ...ambient, hours_h: ambient.hours_h.map((h) => h - offset) },
    duration_hours: c.cure_window_h,
    t_ref_c: c.t_ref_c,
  };
}

/** Length in metres. A VIEW parameter for the extrusion, never a solved quantity. */
export function lengthM(c: ElementConfig): number {
  return c.length_mm / 1000;
}
