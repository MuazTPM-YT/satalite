// test synthetic thermal simulation generator
import {
  createTBeamOutline,
  createTBeamGrid,
  generateMockThermalSimulation,
  getPourWindowCandidates,
} from "./mockThermalField";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

console.log("TESTING MOCK THERMAL SIMULATION GENERATOR...");

// 1. test T-beam outline
const outline = createTBeamOutline(0.6, 0.15, 0.25, 0.5);
assert(outline.length === 8, "Outline should have exactly 8 vertices for T-beam");
assert(outline[0][0] === 0.175 && outline[0][1] === 0.0, "Vertex 0 should be at [0.175, 0.0]");
assert(outline[4][0] === 0.6 && outline[4][1] === 0.5, "Vertex 4 should be top right flange [0.6, 0.5]");
assert(outline[5][0] === 0.0 && outline[5][1] === 0.5, "Vertex 5 should be top left flange [0.0, 0.5]");
console.log("✓ Outline geometry validated (8 vertices, valid closed T-shape)");

// 2. test grid and mask
const grid = createTBeamGrid(0.0125);
assert(grid.nx === 48, "Grid nx should be 48 for 0.6m at 0.0125m dx");
assert(grid.ny === 40, "Grid ny should be 40 for 0.5m at 0.0125m dx");
assert(grid.mask.length === grid.ny, "Mask rows must match ny");
assert(grid.mask[0].length === grid.nx, "Mask cols must match nx");

// count active concrete cells
const totalConcreteCells = grid.mask.reduce(
  (sum, row) => sum + row.reduce((rSum, val) => rSum + val, 0),
  0
);
const concreteArea_m2 = totalConcreteCells * grid.dx_m * grid.dx_m;
// expected area: flange (0.6 * 0.15 = 0.09) + web (0.25 * 0.35 = 0.0875) = 0.1775 m2
assert(
  Math.abs(concreteArea_m2 - 0.1775) < 0.005,
  `Concrete area ${concreteArea_m2.toFixed(4)} m2 should be close to 0.1775 m2`
);
console.log(`✓ Grid & mask validated: ${totalConcreteCells} cells, ${concreteArea_m2.toFixed(4)} m²`);

// 3. test full thermal simulation generation
const sim = generateMockThermalSimulation();
const num_times = sim.times_h.length;
assert(num_times === 145, `Expected 145 time steps (0 to 72h by 0.5h), got ${num_times}`);
assert(sim.fields.temperature_c.length === num_times, "Temperature field slices must match times_h");
assert(sim.fields.maturity_ch.length === num_times, "Maturity field slices must match times_h");
assert(sim.fields.strength_frac.length === num_times, "Strength field slices must match times_h");
assert(sim.curves.core_temp_c.length === num_times, "Core temp curve length must match times_h");
assert(sim.curves.surface_temp_c.length === num_times, "Surface temp curve length must match times_h");
assert(sim.curves.strength_frac.length === num_times, "Strength curve length must match times_h");
console.log(`✓ Array lengths match: all 3D fields and 1D curves have ${num_times} time points`);

// 4. test core >= surface at all times
let minCoreMinusSurf = Infinity;
for (let t = 0; t < num_times; t++) {
  const core = sim.curves.core_temp_c[t];
  const surf = sim.curves.surface_temp_c[t];
  const diff = core - surf;
  if (diff < minCoreMinusSurf) minCoreMinusSurf = diff;
  assert(
    core >= surf - 0.01,
    `At t=${sim.times_h[t]}h, core temp (${core}°C) is lower than surface temp (${surf}°C)`
  );
}
console.log(`✓ Core temp >= Surface temp holds for all 145 time steps (min diff = ${minCoreMinusSurf.toFixed(2)}°C)`);

// 5. test peak core temperature and timing
let peakTemp = -Infinity;
let peakTime_h = 0;
for (let t = 0; t < num_times; t++) {
  if (sim.curves.core_temp_c[t] > peakTemp) {
    peakTemp = sim.curves.core_temp_c[t];
    peakTime_h = sim.times_h[t];
  }
}
assert(
  peakTime_h >= 15 && peakTime_h <= 20,
  `Peak core temp should land between 15h and 20h, got ${peakTime_h}h`
);
assert(
  Math.abs(peakTemp - 58.0) <= 1.0,
  `Peak core temp should be ~58.0°C per spec, got ${peakTemp}°C`
);
console.log(`✓ Peak core temperature lands at ${peakTime_h}h with value ${peakTemp}°C`);

// 6. test pour window candidates
const candidates = getPourWindowCandidates();
assert(candidates.length === 3, "Expected 3 pour window candidates");
assert(candidates[0].start_time === "04:00" && candidates[0].selected === true, "First row is 04:00 selected");
assert(candidates[1].start_time === "09:00", "Second row is 09:00");
assert(candidates[2].start_time === "14:00" && candidates[2].fastest === true, "Third row is 14:00 fastest");
console.log("✓ Pour window candidates validated (04:00 selected, 09:00, 14:00 fail/fastest)");

console.log("\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
