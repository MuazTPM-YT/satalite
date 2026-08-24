// self-check, no backend needed.
//   npx tsx src/lib/test_section_metrics.ts
//
// Distances and volumes are the two things on screen a reader will take a number off
// and use. Both are pure geometry, so both are checkable against hand arithmetic.
import { probeGeometry, cutMetrics, maskArea_m2, edgeTag, elevationLines } from "./sectionMetrics";
import { outlineFor, polygonArea_m2 } from "./shapes";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function near(a: number, b: number, tol = 1e-9) {
  return Math.abs(a - b) < tol;
}

// a 0.6 x 0.5 rectangle, probed off-centre
const rect = outlineFor("rect_column", { width: 600, height: 500 })!;
const g = probeGeometry(rect, [0.1, 0.2]);

assert(near(g.bbox.left_m, 0.1), `left face 0.100, got ${g.bbox.left_m}`);
assert(near(g.bbox.right_m, 0.5), `right face 0.500, got ${g.bbox.right_m}`);
assert(near(g.bbox.bottom_m, 0.2), `soffit 0.200, got ${g.bbox.bottom_m}`);
assert(near(g.bbox.top_m, 0.3), `top face 0.300, got ${g.bbox.top_m}`);
// the nearest face is the left one at 0.1 — that is the cover
assert(near(g.cover_m, 0.1), `cover 0.100, got ${g.cover_m}`);
// nearest corner is [0, 0]: hypot(0.1, 0.2)
assert(near(g.corners[0].distance_m, Math.hypot(0.1, 0.2)), "nearest corner");
assert(g.corners[0].at[0] === 0 && g.corners[0].at[1] === 0, "nearest corner is the origin");
assert(g.edges.every((e, i, a) => i === 0 || a[i - 1].distance_m <= e.distance_m), "edges sorted");
assert(g.edges[0].orientation === "vertical", `nearest edge is the left wall, got ${g.edges[0].orientation}`);
console.log(`rect probe   cover ${g.cover_m.toFixed(3)} m · nearest corner ${g.corners[0].distance_m.toFixed(4)} m`);

// a T-section: the re-entrant corner under the flange must be reachable as an edge
const tee = outlineFor("t_section", {
  flange_width: 900,
  flange_thickness: 150,
  web_width: 300,
  height: 750,
})!;
const tg = probeGeometry(tee, [0.45, 0.3]); // mid-web
// half the web is 0.15, and the web runs from x = 0.3 to 0.6
assert(near(tg.cover_m, 0.15), `T web cover 0.150, got ${tg.cover_m}`);
assert(near(polygonArea_m2(tee), 0.9 * 0.15 + 0.3 * 0.6), "T area from the shoelace");
console.log(`tee probe    cover ${tg.cover_m.toFixed(3)} m · area ${polygonArea_m2(tee).toFixed(4)} m²`);

// the section cut. 6 m of a 0.18 m² beam, cut at 40%.
const beam = outlineFor("beam", { width: 300, height: 600 })!;
const cut = cutMetrics(beam, 6, 0.4);
assert(near(cut.face_area_m2, 0.18), `cut face 0.18 m², got ${cut.face_area_m2}`);
assert(near(cut.total_volume_m3, 1.08), `total 1.08 m³, got ${cut.total_volume_m3}`);
assert(near(cut.kept_volume_m3, 0.432), `kept 0.432 m³, got ${cut.kept_volume_m3}`);
assert(near(cut.removed_volume_m3, 0.648), `removed 0.648 m³, got ${cut.removed_volume_m3}`);
assert(near(cut.at_m, 2.4), `cut at 2.4 m, got ${cut.at_m}`);
assert(near(cut.face_perimeter_m, 2 * (0.3 + 0.6)), "perimeter 1.8 m");
assert(near(cut.removed_mass_kg, 0.648 * 2400), "removed mass at 2400 kg/m³");
console.log(
  `beam cut     at ${cut.at_m} m · removed ${cut.removed_volume_m3.toFixed(3)} m³ ` +
    `(${(cut.removed_mass_kg / 1000).toFixed(2)} t) of ${cut.total_volume_m3.toFixed(3)} m³`,
);

// uncut and fully cut are the two ends, not special cases
assert(near(cutMetrics(beam, 6, 1).removed_volume_m3, 0), "uncut removes nothing");
assert(near(cutMetrics(beam, 6, 0).kept_volume_m3, 0), "fully cut keeps nothing");

// a mask area counts only cells that hold a temperature. Nulls are holes, not cold.
const frame = [
  [20, 20, null],
  [20, null, null],
];
assert(near(maskArea_m2(frame, 0.1), 3 * 0.01), `mask area 0.03 m², got ${maskArea_m2(frame, 0.1)}`);

// ── edge identity ────────────────────────────────────────────────────────────
// A distance to "edge 3" is a distance to nothing a reader can point at. Every edge
// carries the letter drawn on it and the direction it faces, and those two have to be
// right or the annotation is worse than none.
const rectEdges = probeGeometry(rect, [0.3, 0.25]).edges;
const byIndex = [...rectEdges].sort((a, b) => a.index - b.index);
assert(byIndex.map((e) => e.tag).join("") === "ABCD", `rect tags ABCD, got ${byIndex.map((e) => e.tag).join("")}`);
// geometry.py winds a rectangle [0,0] [w,0] [w,h] [0,h] counter-clockwise
assert(byIndex[0].facing === "soffit", `edge A faces the soffit, got ${byIndex[0].facing}`);
assert(byIndex[1].facing === "right", `edge B is the right face, got ${byIndex[1].facing}`);
assert(byIndex[2].facing === "top", `edge C is the top face, got ${byIndex[2].facing}`);
assert(byIndex[3].facing === "left", `edge D is the left face, got ${byIndex[3].facing}`);
assert(near(byIndex[0].from[0], 0) && near(byIndex[0].to[0], 0.6), "edge A runs the full width");
assert(edgeTag(0) === "A" && edgeTag(25) === "Z" && edgeTag(26) === "A1", "tags past Z carry a digit");
console.log(`rect edges   ${byIndex.map((e) => `${e.tag}:${e.facing}`).join(" ")}`);

// ── orthographic elevations ──────────────────────────────────────────────────
// A T seen from the left: the flange soffit is a real step in the silhouette, so it
// draws solid. Seen from above, the two web faces are under the flange — dashed.
const teeSide = elevationLines(tee, 1, "min");
assert(teeSide.length === 1, `T side elevation has one lengthwise edge, got ${teeSide.length}`);
assert(near(teeSide[0].at_m, 0.6), `flange soffit at y 0.600, got ${teeSide[0].at_m}`);
assert(!teeSide[0].hidden, "the flange soffit is visible from the side");

const teePlan = elevationLines(tee, 0, "max");
assert(teePlan.length === 2, `T plan has two lengthwise edges, got ${teePlan.length}`);
assert(teePlan.every((l) => l.hidden), "the web faces are hidden under the flange in plan");
assert(near(teePlan[0].at_m, 0.3) && near(teePlan[1].at_m, 0.6), "web faces at x 0.300 and 0.600");
console.log(`tee elevation side ${teeSide.map((l) => (l.hidden ? "dashed" : "solid")).join(",")} · plan ${teePlan.map((l) => (l.hidden ? "dashed" : "solid")).join(",")}`);

// An L seen from the left: the top of the leg sits behind the upstand, so it is the
// hidden line the whole feature exists for.
const ell = outlineFor("l_section", { width: 600, height: 600, leg_thickness: 150 })!;
const ellSide = elevationLines(ell, 1, "min");
assert(ellSide.length === 1 && near(ellSide[0].at_m, 0.15), "L has one lengthwise edge, at y 0.150");
assert(ellSide[0].hidden, "the top of the L's leg is hidden behind the upstand from the left");
// from the right the same edge is the silhouette's own step, so it is visible
assert(elevationLines(ell, 1, "max")[0].hidden === false, "and visible from the right");
console.log(`ell elevation left ${ellSide[0].hidden ? "dashed" : "solid"} · right ${elevationLines(ell, 1, "max")[0].hidden ? "dashed" : "solid"}`);

// a plain rectangle has no lengthwise edge that is not already the outline
assert(elevationLines(rect, 1, "min").length === 0, "a rectangle elevation has no interior edges");

console.log("\nSECTION METRICS OK.");
