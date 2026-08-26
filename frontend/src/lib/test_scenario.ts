// self-check, no backend needed.
//   npx tsx src/lib/test_scenario.ts
//
// Two pure functions the studio's inputs depend on: the pour sweep's candidate start
// hours, and reading a config back off a request the backend solved.
import { candidateOffsets, N_CANDIDATES, requestKey } from "./scenario";
import {
  DEFAULT_ELEMENT_CONFIG,
  configFromRequest,
  toSimulationRequest,
} from "./elementConfig";
import type { AmbientSpec, SimulationRequest } from "./api";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

/* ── candidate offsets ──────────────────────────────────────────────────────── */

// 96 h of weather, a 72 h window: 24 h of room, six starts across it.
const wide = candidateOffsets(96, 72);
assert(wide.length === N_CANDIDATES, `six candidates over 24 h of room, got ${wide.length}`);
assert(wide[0] === 0, `the first candidate is now, got ${wide[0]}`);
assert(
  wide[wide.length - 1] === 24,
  `the last candidate is the last start still inside real weather, got ${wide[wide.length - 1]}`,
);

// THE case the hardcoded list got wrong: a window that uses nearly all the series.
// There is no room to start later, so the only honest candidate is now.
assert(
  JSON.stringify(candidateOffsets(96, 96)) === "[0]",
  `no room means one candidate, got ${JSON.stringify(candidateOffsets(96, 96))}`,
);
assert(
  JSON.stringify(candidateOffsets(96, 120)) === "[0]",
  `a window longer than the series means one candidate, got ${JSON.stringify(candidateOffsets(96, 120))}`,
);

// A window that leaves less room than there are candidates must not repeat an hour:
// the backend would solve the same start three times and report it three times.
const tight = candidateOffsets(96, 93);
assert(
  new Set(tight).size === tight.length,
  `candidates must be distinct, got ${JSON.stringify(tight)}`,
);
assert(tight.every((h) => h >= 0 && h <= 3), `every candidate inside the room, got ${JSON.stringify(tight)}`);

// every candidate is a whole hour, ascending
assert(
  wide.every((h, i) => Number.isInteger(h) && (i === 0 || h > wide[i - 1])),
  `whole hours, ascending, got ${JSON.stringify(wide)}`,
);

/* ── config round trip ──────────────────────────────────────────────────────── */

const ambient: AmbientSpec = {
  hours_h: [0, 1, 2],
  air_temp_c: [30, 31, 32],
  rh_frac: [0.2, 0.2, 0.2],
  wind_ms: [2.5, 2.5, 2.5],
  cloud_pct: [10, 10, 10],
  ghi_w_m2: [900, 800, 600],
  sky_offset_c: 6,
};

// THE property the studio depends on: reading a solved request back into the inputs
// and rebuilding it must give the SAME request. That equality is what lets the
// ensemble panel say whether the band on screen belongs to the run beside it.
const scenario: SimulationRequest = {
  element: {
    shape: "slab",
    dims_mm: { width: 3000, thickness: 300 },
    dx_m: 0.01,
    placement_temp_c: 46.111849288266136,
    formwork: "plywood_18mm",
    on_ground: false,
    probe_xy_m: null,
    surface_probe_depth_m: 0.05,
  },
  mix: {
    mix_id: "standard",
    cement_type: null,
    cementitious_kg_m3: null,
    w_cm: null,
    fly_ash_frac: null,
    silica_fume_frac: null,
    h_u_j_per_kg: null,
    alpha_u: null,
    tau_h: null,
    beta: null,
    grade: "4000psi",
  },
  ambient,
  duration_hours: 72,
  t_ref_c: 20,
};

const rebuilt = toSimulationRequest(configFromRequest(scenario), ambient);
assert(
  requestKey(rebuilt) === requestKey(scenario),
  `round trip must be exact.\n  want ${requestKey(scenario)}\n  got  ${requestKey(rebuilt)}`,
);

// requestKey must not care about key ORDER — that is the whole reason it exists — and
// must still care about every value.
assert(
  requestKey({ a: 1, b: 2 }) === requestKey({ b: 2, a: 1 }),
  "requestKey must be order-independent",
);
assert(requestKey({ a: 1 }) !== requestKey({ a: 2 }), "requestKey must still see values");
assert(
  requestKey({ a: [1, 2] }) !== requestKey({ a: [2, 1] }),
  "requestKey must NOT reorder arrays — an ambient series is a sequence",
);

// A mix DESIGN is the other shape on the wire, and it has to round trip too.
const design: SimulationRequest = {
  ...scenario,
  mix: {
    mix_id: "design",
    cement_type: "II",
    cementitious_kg_m3: 380,
    w_cm: 0.42,
    fly_ash_frac: 0.25,
    silica_fume_frac: null,
    h_u_j_per_kg: null,
    alpha_u: null,
    tau_h: null,
    beta: null,
    grade: "5000psi",
  },
};
const designBack = configFromRequest(design);
assert(designBack.wcm === 0.42, `w_cm reads back, got ${designBack.wcm}`);
assert(designBack.fly_ash_pct === 25, `fly ash comes back as a PERCENT, got ${designBack.fly_ash_pct}`);
assert(
  requestKey(toSimulationRequest(designBack, ambient)) === requestKey(design),
  `design round trip must be exact, got ${requestKey(toSimulationRequest(designBack, ambient))}`,
);

// An unknown shape must not be written into the config: the request would 422.
const bogus = configFromRequest({ ...scenario, element: { ...scenario.element, shape: "hexagon" } });
assert(bogus.shape === DEFAULT_ELEMENT_CONFIG.shape, `unknown shape falls back, got ${bogus.shape}`);

console.log("scenario self-check OK");
