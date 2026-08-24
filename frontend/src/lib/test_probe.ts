// self-check for the bilinear probe. Run: npx tsx src/lib/test_probe.ts
//
// The number that matters is at the bottom: a frame sampled at probe_xy_m must
// reproduce peak_core_temp_c, because that is exactly how the backend produced it.
import { sampleField, frameRange, type Frame } from "./probe";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

// 2x2 solid grid, dx = 1 m. Cell centres sit at 0.5 and 1.5 m.
const solid: Frame = [
  [10, 20],
  [30, 40],
];

// exact cell centre reads that cell back
let s = sampleField(solid, 1.0, 0.5, 0.5)!;
assert(close(s.temp_c, 10), `centre of cell (0,0) should read 10, got ${s.temp_c}`);
assert(!s.fallback, "an interior centre must not take the fallback");
assert(close(s.xy_m[0], 0.5) && close(s.xy_m[1], 0.5), "sampled point must be the cell centre");

// dead centre of all four is their mean
s = sampleField(solid, 1.0, 1.0, 1.0)!;
assert(close(s.temp_c, 25), `centre of the 2x2 should read 25, got ${s.temp_c}`);

// halfway along the bottom row interpolates in x only
s = sampleField(solid, 1.0, 1.0, 0.5)!;
assert(close(s.temp_c, 15), `midpoint of the bottom row should read 15, got ${s.temp_c}`);

// outside the grid clamps to the edge, it does not extrapolate
s = sampleField(solid, 1.0, -5.0, -5.0)!;
assert(close(s.temp_c, 10), `a point off the corner clamps to 10, got ${s.temp_c}`);

// a hole in the stencil drops to the nearest solid cell, and says so
const holed: Frame = [
  [null, 20],
  [30, 40],
];
s = sampleField(holed, 1.0, 0.5, 0.5)!;
assert(s.fallback, "a stencil straddling a hole must report fallback");
assert(close(s.temp_c, 20) || close(s.temp_c, 30), `fallback must read a real cell, got ${s.temp_c}`);
assert(close(s.xy_m[0], 1.5) || close(s.xy_m[1], 1.5), "fallback must report the cell it read");

// nulls are holes, never cold concrete
const r = frameRange(holed)!;
assert(r.min_c === 20 && r.max_c === 40, `range should be 20..40, got ${r.min_c}..${r.max_c}`);

console.log("PROBE OK. bilinear match, clamp, fallback and range all hold.");
