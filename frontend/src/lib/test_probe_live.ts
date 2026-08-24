// integration self-check against a running backend.
//   npx tsx src/lib/test_probe_live.ts
//
// The claim being tested: clicking the point the backend reports as probe_xy_m, on the
// frame where the core peaks, must give back peak_core_temp_c. If it does not, the
// viewer and the solver disagree about where a number came from.
import { loadDemoRun } from "./scenario";
import { sampleField } from "./probe";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
const { result } = await loadDemoRun();
const fields = result.fields;
assert(fields !== null, "the run must carry a per-cell field");
if (!fields) process.exit(1);

console.log(`grid ${fields.nx}x${fields.ny} @ ${fields.dx_m} m, ${fields.times_h.length} frames`);

// the frame where the probe series peaks
const peakSeriesIdx = result.core_temp_c.indexOf(Math.max(...result.core_temp_c));
const frameIdx = fields.frame_indices.indexOf(peakSeriesIdx);
assert(frameIdx >= 0, "the peak-core frame must survive the stride");

const [px, py] = result.probe_xy_m;
const s = sampleField(fields.temp_c[frameIdx], fields.dx_m, px, py);
assert(s !== null, "the probe point must land on concrete");
if (!s) process.exit(1);

const delta = Math.abs(s.temp_c - result.peak_core_temp_c);
console.log(`probe_xy_m      [${px.toFixed(4)}, ${py.toFixed(4)}] m`);
console.log(`sampled point   [${s.xy_m[0].toFixed(4)}, ${s.xy_m[1].toFixed(4)}] m`);
console.log(`bilinear        ${s.temp_c.toFixed(4)} C`);
console.log(`peak_core_temp_c ${result.peak_core_temp_c.toFixed(4)} C`);
console.log(`delta           ${delta.toFixed(5)} C`);

// the field is serialised at 2 dp, so 0.005 C per cell is the floor. Anything above
// 0.01 C means the two are not sampling the same thing.
assert(delta < 0.01, `probe disagrees with peak_core_temp_c by ${delta.toFixed(5)} C`);
assert(
  Math.abs(s.xy_m[0] - px) < 1e-9 && Math.abs(s.xy_m[1] - py) < 1e-9,
  "the sampled point must be the point the backend reported",
);

// nulls must be holes, never numbers
const flat = fields.temp_c[0].flat();
assert(flat.some((v) => v !== null), "the section must carry temperatures");

console.log("LIVE PROBE OK. viewer and solver agree on the same point.");
}

main();
