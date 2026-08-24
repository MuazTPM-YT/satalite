// integration self-check against a running backend.
//   npx tsx src/lib/test_studio_live.ts
//
// The claim being tested: the request the studio builds from its own default inputs is
// a request the backend accepts, and the mix it describes by DESIGN (content, w/cm,
// fly ash) reaches the solver as the same mix the fixed scenario was solved with.
//
// That second half is the one worth a test. The frontend deliberately does not compute
// h_u, alpha_u or tau_h - it sends the design and lets the backend's own hydration
// equations do it - so the only way to know the translation is right is to solve both
// ways and compare the answers.
import { demoEnsemble, simulate } from "./api";
import { DEFAULT_ELEMENT_CONFIG, toSimulationRequest } from "./elementConfig";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const demo = await demoEnsemble();
  const ambient = demo.scenario.ambient;

  // The studio's defaults are the standard element and the standard mix DESIGN.
  const request = toSimulationRequest(DEFAULT_ELEMENT_CONFIG, ambient);
  assert(request.mix?.mix_id === "design", "the studio must send a design mix");
  assert(request.mix?.h_u_j_per_kg == null, "the studio must NOT compute hydration parameters itself");

  const byDesign = await simulate(
    { ...request, element: { ...request.element, dx_m: 0.02 } },
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

  // a changed input has to change the answer, or nothing is actually driving the solve
  const hotter = await simulate(
    {
      ...request,
      element: { ...request.element, dx_m: 0.02, placement_temp_c: 35 },
    },
    {},
  );
  const shift = hotter.peak_core_temp_c - byDesign.peak_core_temp_c;
  console.log(`+6 C placement moves peak_core by ${shift.toFixed(3)} C`);
  assert(shift > 1.0, "raising the placement temperature must raise the peak core");

  console.log("\nSTUDIO OK. inputs reach the solver and the answer follows them.");
}

main();
