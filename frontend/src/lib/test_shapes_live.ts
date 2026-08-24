// integration self-check against a running backend.
//   npx tsx src/lib/test_shapes_live.ts
//
// The claim being tested: lib/shapes.ts is a faithful mirror of
// backend/physics/geometry.outline(). Every shape, every vertex, to the last decimal.
//
// This matters because the input panel draws its cross-section preview from the
// TypeScript copy and the viewer draws the solved section from outline_m. If the two
// constructions ever drift, the preview becomes a drawing of a section nobody is
// going to pour - and it would drift silently, because both would still look like
// plausible concrete.
import { demoEnsemble, simulate } from "./api";
import { SHAPE_DEFS, outlineFor, polygonArea_m2 } from "./shapes";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const demo = await demoEnsemble();
  const ambient = demo.scenario.ambient;

  for (const def of SHAPE_DEFS) {
    const dims_mm = Object.fromEntries(def.dims.map((d) => [d.key, d.default_mm]));
    const mine = outlineFor(def.id, dims_mm);
    assert(mine !== null, `${def.id}: the local outline must build from its own defaults`);
    if (!mine) return;

    // A coarse grid and a short duration: this checks geometry, not physics, and a
    // 5 mm 72 h solve per shape would make the check too slow to ever be run.
    const result = await simulate(
      {
        element: { shape: def.id, dims_mm, dx_m: 0.025, placement_temp_c: 25, formwork: "plywood_18mm" },
        mix: { mix_id: "standard", grade: "4000psi" },
        ambient,
        duration_hours: 12,
      },
      {},
    );

    const theirs = result.outline_m;
    assert(
      theirs.length === mine.length,
      `${def.id}: vertex count differs — backend ${theirs.length}, local ${mine.length}`,
    );
    for (let i = 0; i < theirs.length; i++) {
      const dx = Math.abs(theirs[i][0] - mine[i][0]);
      const dy = Math.abs(theirs[i][1] - mine[i][1]);
      assert(
        dx < 1e-9 && dy < 1e-9,
        `${def.id}: vertex ${i} differs — backend [${theirs[i]}], local [${mine[i]}]`,
      );
    }
    console.log(
      `${def.id.padEnd(17)} ${String(theirs.length).padStart(3)} vertices  ` +
        `${polygonArea_m2(mine).toFixed(4)} m²  peak ${result.peak_core_temp_c.toFixed(2)} C`,
    );
  }

  console.log(`\nSHAPES OK. ${SHAPE_DEFS.length} shapes, vertex-for-vertex.`);
}

main();
