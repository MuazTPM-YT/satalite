// integration self-check against a running backend.
//   npx tsx src/lib/test_studio_live.ts
//
// Three claims are tested here.
//
// The studio opens on the scenario the artifact was actually solved for: it reads the
// inputs back off the request and must rebuild that request exactly, because that
// equality is what lets the ensemble panel say the band belongs to the run beside it.
//
// The mix it describes by DESIGN (content, w/cm, fly ash) reaches the solver as the
// same mix the standard one is. The frontend deliberately does not compute h_u,
// alpha_u or tau_h - it sends the design and lets the backend's own hydration
// equations do it - so the only way to know the translation is right is to solve both
// ways and compare the answers.
//
// And a changed input changes the answer, or nothing is driving the solve at all.
import { demoEnsemble, simulate } from "./api";
import { configFromRequest, toSimulationRequest } from "./elementConfig";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const demo = await demoEnsemble();
  const ambient = demo.scenario.ambient;

  // What the studio opens on: the artifact's own scenario, read back into the inputs.
  const opened = configFromRequest(demo.scenario);
  const request = toSimulationRequest(opened, ambient);
  assert(
    JSON.stringify(request) === JSON.stringify(demo.scenario),
    "the studio must open on the scenario the artifact was solved for, exactly",
  );

  // the same inputs, described as a mix DESIGN rather than by name
  const design = toSimulationRequest({ ...opened, mix_id: "design" }, ambient);
  assert(design.mix?.mix_id === "design", "the design basis must send a design mix");
  assert(design.mix?.h_u_j_per_kg == null, "the studio must NOT compute hydration parameters itself");

  const byDesign = await simulate(
    { ...design, element: { ...design.element, dx_m: 0.02 } },
    { fields: true, fields_stride_h: 6 },
  );

  // the same element and weather, solved with the backend's named standard mix.
  const byName = await simulate(
    {
      element: { ...request.element, dx_m: 0.02 },
      mix: { mix_id: "standard", grade: "4000psi" },
      ambient,
      duration_hours: request.duration_hours,
      t_ref_c: request.t_ref_c,
    },
    {},
  );

  const dPeak = Math.abs(byDesign.peak_core_temp_c - byName.peak_core_temp_c);
  console.log(`design mix   peak_core ${byDesign.peak_core_temp_c.toFixed(4)} C`);
  console.log(`standard mix peak_core ${byName.peak_core_temp_c.toFixed(4)} C`);
  console.log(`delta        ${dPeak.toExponential(2)} C`);
  assert(
    dPeak < 1e-6,
    `the design mix must reproduce the standard mix at its own design values, off by ${dPeak}`,
  );

  const fields = byDesign.fields;
  assert(fields !== null, "the studio always asks for fields=true");
  if (!fields) return;
  assert(
    fields.temp_c[0].flat().some((v) => v !== null),
    "the solved section must carry temperatures",
  );
  console.log(
    `fields       ${fields.nx}x${fields.ny} @ ${fields.dx_m} m, ${fields.times_h.length} frames`,
  );
  console.log(`outline      ${byDesign.outline_m.length} vertices`);

  // A changed input has to change the answer, or nothing is actually driving the solve.
  // Relative to the scenario's OWN placement temperature, not to a number typed here —
  // the studio opens on whatever the artifact carries.
  // 50 C is the backend's own bound on placement_temp_c, and the scenario already
  // places at 46 - so the step is whatever room is left, not a fixed +6.
  const warmer_c = Math.min(50, design.element.placement_temp_c! + 6);
  const hotter = await simulate(
    {
      ...design,
      element: { ...design.element, dx_m: 0.02, placement_temp_c: warmer_c },
    },
    {},
  );
  const shift = hotter.peak_core_temp_c - byDesign.peak_core_temp_c;
  console.log(`placement ${design.element.placement_temp_c!.toFixed(1)} -> ${warmer_c.toFixed(1)} C moves peak_core by ${shift.toFixed(3)} C`);
  assert(shift > 1.0, "raising the placement temperature must raise the peak core");

  console.log("\nSTUDIO OK. inputs reach the solver and the answer follows them.");
}

main();
