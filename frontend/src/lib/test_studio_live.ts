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

  /* ── every visual follows every input ─────────────────────────────────────── */
  //
  // "Are the graphs dynamic" is really "does each array a visual reads move when the
  // input that should move it moves". The studio draws everything from ONE solve:
  //
  //   2D sheet / 3D viewer   fields.temp_c, outline_m
  //   temperature track      core_temp_c, surface_temp_c
  //   strength track         strength_fraction
  //   differential track     core_temp_c - surface_temp_c
  //
  // So each input class is changed one at a time and the specific arrays are compared.
  // Asserting on peak_core alone would pass even if every series were frozen.

  const base = {
    ...design,
    // coarse and short on purpose: this is a wiring check, not a physics one, and a
    // 10 mm 72 h solve is six seconds each way
    element: { ...design.element, dx_m: 0.04 },
    duration_hours: 12,
  };
  const withFields = (r: typeof base) => simulate(r, { fields: true, fields_stride_h: 4 });
  const b = await withFields(base);

  const moved = (x: number[], y: number[]) =>
    x.length !== y.length || x.some((v, i) => v !== y[i]);
  const diffSeries = (r: { core_temp_c: number[]; surface_temp_c: number[] }) =>
    r.core_temp_c.map((c, i) => c - r.surface_temp_c[i]);

  // The invariant the differential panel rests on: the series it derives is exactly the
  // one the backend reduced to a scalar, so its maximum IS that scalar. If this ever
  // parts company, the panel is drawing something the checks are not describing.
  const d0 = diffSeries(b);
  assert(
    Math.abs(Math.max(...d0) - b.max_core_surface_diff_c) < 1e-9,
    `the differential series must peak at max_core_surface_diff_c, off by ${Math.abs(Math.max(...d0) - b.max_core_surface_diff_c)}`,
  );

  // DIMENSIONS -> geometry, grid and heat
  const dims = base.element.dims_mm;
  const dimKey = "thickness" in dims ? "thickness" : Object.keys(dims)[0];
  const thicker = await withFields({
    ...base,
    element: { ...base.element, dims_mm: { ...dims, [dimKey]: dims[dimKey] * 2 } },
  });
  assert(
    JSON.stringify(thicker.outline_m) !== JSON.stringify(b.outline_m),
    "a changed dimension must change the outline both viewers draw",
  );
  assert(
    thicker.fields!.ny !== b.fields!.ny || thicker.fields!.nx !== b.fields!.nx,
    "a changed dimension must change the solved grid the viewers colour",
  );
  assert(moved(thicker.core_temp_c, b.core_temp_c), "a changed dimension must move the core series");
  assert(
    moved(diffSeries(thicker), d0),
    "a changed dimension must move the differential series",
  );
  console.log(
    `dimension    ${dimKey} x2 -> outline ${b.outline_m.length}->${thicker.outline_m.length} pts, ` +
      `grid ${b.fields!.nx}x${b.fields!.ny}->${thicker.fields!.nx}x${thicker.fields!.ny}, ` +
      `peak_core ${b.peak_core_temp_c.toFixed(2)}->${thicker.peak_core_temp_c.toFixed(2)} C`,
  );

  // MIX -> heat and strength. Two knobs, because they enter by different routes:
  // w/cm moves the hydration regression, fly ash replaces cement that would have
  // generated heat.
  for (const [what, mix] of [
    ["w/cm", { ...base.mix, w_cm: (base.mix!.w_cm ?? 0.45) - 0.07 }],
    ["fly ash", { ...base.mix, fly_ash_frac: 0 }],
  ] as [string, typeof base.mix][]) {
    const changed = await withFields({ ...base, mix });
    assert(moved(changed.core_temp_c, b.core_temp_c), `${what} must move the core series`);
    assert(
      moved(changed.strength_fraction, b.strength_fraction),
      `${what} must move the strength series`,
    );
    assert(moved(diffSeries(changed), d0), `${what} must move the differential series`);
    console.log(
      `mix ${what.padEnd(8)} peak_core ${b.peak_core_temp_c.toFixed(2)}->${changed.peak_core_temp_c.toFixed(2)} C, ` +
        `final strength ${(b.strength_fraction.at(-1)! * 100).toFixed(1)}->${(changed.strength_fraction.at(-1)! * 100).toFixed(1)}%`,
    );
  }

  // CURE WINDOW -> how much of everything there is to draw
  const longer = await withFields({ ...base, duration_hours: 24 });
  assert(
    longer.times_h.length > b.times_h.length,
    "a longer cure window must give the graphs more to draw",
  );
  assert(
    longer.fields!.times_h.length > b.fields!.times_h.length,
    "a longer cure window must give the scrubber more frames",
  );

  // t_ref_c -> the maturity clock AND the heat, which is not the obvious answer.
  //
  // The reference temperature reads like a post-hoc scale on strength, so this check
  // was first written asserting the thermal series comes back untouched. It failed, and
  // the code was right: physics/solver.py:217 advances equivalent age by
  // maturity.rate_multiplier(temp_c, t_ref_c) INSIDE the stepping loop, and that
  // equivalent age is what hydration.d_alpha_d_te turns into the heat source. Move the
  // reference and you move where the mix sits on its own hydration curve at a given
  // real hour, so the temperature moves too. Recorded here rather than corrected
  // quietly, because "t_ref only affects maturity" is a plausible thing to assume twice.
  const t_ref = await withFields({ ...base, t_ref_c: (base.t_ref_c ?? 20) + 5 });
  assert(moved(t_ref.core_temp_c, b.core_temp_c), "t_ref_c must move the core series");
  assert(
    moved(t_ref.strength_fraction, b.strength_fraction),
    "t_ref_c must move the maturity-derived strength",
  );
  console.log(
    `t_ref        ${base.t_ref_c ?? 20}->${(base.t_ref_c ?? 20) + 5} C moves peak_core ` +
      `${b.peak_core_temp_c.toFixed(2)}->${t_ref.peak_core_temp_c.toFixed(2)} C and final strength ` +
      `${(b.strength_fraction.at(-1)! * 100).toFixed(1)}->${(t_ref.strength_fraction.at(-1)! * 100).toFixed(1)}%`,
  );

  // The discriminator these all rest on: the solve is DETERMINISTIC. Every assertion
  // above reads "the output changed", which only means "the input changed it" if the
  // same input cannot produce a different output on its own.
  const again = await withFields(base);
  assert(
    !moved(again.core_temp_c, b.core_temp_c) &&
      !moved(again.strength_fraction, b.strength_fraction) &&
      !moved(diffSeries(again), d0),
    "the same request must solve to the same series, or none of the above means anything",
  );

  console.log("\nSTUDIO OK. inputs reach the solver and the answer follows them.");
}

main();
