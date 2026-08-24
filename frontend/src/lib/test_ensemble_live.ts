// integration self-check for the ensemble panel's central claim.
//   npx tsx src/lib/test_ensemble_live.ts
//
// The panel argues something specific: the nominal DEF flag is false WHILE the p95 band
// edge crosses the DEF threshold. If a regenerated artifact ever removes that crossing,
// the panel's whole explanation stops describing the data and must be revisited. This
// test is what notices.
import { demoEnsemble } from "./api";
import { loadDemoRun } from "./scenario";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const demo = await demoEnsemble();
  const { result } = await loadDemoRun();
  const band = demo.ensemble.core_temp_c;
  const def_c = result.breaches.def_threshold_c;

  // every percentile is the same length, or the band is not a band
  const lens = new Set([band.p05, band.p25, band.p50, band.p75, band.p95].map((a) => a.length));
  assert(lens.size === 1, `percentiles have mismatched lengths: ${[...lens].join(", ")}`);

  // percentiles must be ordered at every frame
  for (let i = 0; i < band.p50.length; i++) {
    assert(
      band.p05[i] <= band.p25[i] && band.p25[i] <= band.p50[i] &&
      band.p50[i] <= band.p75[i] && band.p75[i] <= band.p95[i],
      `percentiles out of order at frame ${i}`,
    );
  }

  const p05 = Math.max(...band.p05);
  const p50 = Math.max(...band.p50);
  const p95 = Math.max(...band.p95);
  const over = band.p95.filter((v) => v > def_c).length;

  console.log(`peaks   p05 ${p05.toFixed(3)}  p50 ${p50.toFixed(3)}  p95 ${p95.toFixed(3)} C`);
  console.log(`DEF     ${def_c} C`);
  console.log(`nominal peak_core_temp_c ${result.peak_core_temp_c.toFixed(3)} C, def_risk ${result.breaches.def_risk}`);
  console.log(`p95 above DEF in ${over} of ${band.p95.length} frames, peak is +${(p95 - def_c).toFixed(3)} C`);

  // the two halves of the claim
  assert(!result.breaches.def_risk, "the nominal run now breaches DEF - the panel's framing no longer applies");
  assert(over > 0, "the p95 edge no longer crosses DEF - the panel's framing no longer applies");
  assert(p50 < def_c, "the p50 curve now crosses DEF, which is a different story entirely");

  // the note is the only place the measured band-edge noise lives, so it has to be there
  assert(demo.note.length > 200, "the artifact note is missing or truncated");

  console.log("ENSEMBLE OK. nominal under the limit, upper tail across it - both true at once.");
}

main();
