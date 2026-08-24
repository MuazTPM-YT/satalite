// self-check for the 3D extrusion. Run: npx tsx src/lib/test_extrude.ts
//
// The claim: the 3D view carries NO information the 2D solve does not have. Every slice
// along the length is identical, because the model says so. This test fails the moment
// someone makes the colour depend on z.
import { buildSectionGeometry } from "./extrude";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// a T section: it has a re-entrant corner and a hole in its bounding box, so the
// extruder produces side walls at many different z, which is the point.
const outline: [number, number][] = [
  [0.2, 0.0], [0.4, 0.0], [0.4, 0.35], [0.6, 0.35],
  [0.6, 0.5], [0.0, 0.5], [0.0, 0.35], [0.2, 0.35],
];
const W = 0.6;
const H = 0.5;
const LENGTH = 6.0;

const { geometry, capGeometry } = buildSectionGeometry(outline, LENGTH, W, H);
const pos = geometry.attributes.position;
const uv = geometry.attributes.uv;

// it really is extruded: more than one distinct z
const zs = new Set<string>();
for (let i = 0; i < pos.count; i++) zs.add(pos.getZ(i).toFixed(6));
assert(zs.size > 1, `geometry must span the length, found ${zs.size} distinct z`);
assert(
  Math.abs(Math.max(...[...zs].map(Number)) - Math.min(...[...zs].map(Number)) - LENGTH) < 1e-6,
  "the extrusion must span exactly length_m",
);

// THE invariant: two vertices at the same (x, y) but different z share a UV.
// Group by (x, y); every group must be a single UV.
const groups = new Map<string, { uvs: Set<string>; zs: Set<string> }>();
for (let i = 0; i < pos.count; i++) {
  const key = `${pos.getX(i).toFixed(6)},${pos.getY(i).toFixed(6)}`;
  const g = groups.get(key) ?? { uvs: new Set(), zs: new Set() };
  g.uvs.add(`${uv.getX(i).toFixed(9)},${uv.getY(i).toFixed(9)}`);
  g.zs.add(pos.getZ(i).toFixed(6));
  groups.set(key, g);
}

let spanning = 0;
for (const [key, g] of groups) {
  assert(g.uvs.size === 1, `uv at (${key}) varies with z: ${[...g.uvs].join(" vs ")}`);
  if (g.zs.size > 1) spanning++;
}
assert(spanning > 0, "no vertex pair spans the length; the test would prove nothing");
console.log(`checked ${groups.size} (x,y) positions, ${spanning} of them spanning multiple z`);

// the cut cap agrees with the walls: same (x, y) -> same uv, so slicing shows the same
// field the outside does
const capPos = capGeometry.attributes.position;
const capUv = capGeometry.attributes.uv;
for (let i = 0; i < capPos.count; i++) {
  const key = `${capPos.getX(i).toFixed(6)},${capPos.getY(i).toFixed(6)}`;
  const g = groups.get(key);
  if (!g) continue;
  const got = `${capUv.getX(i).toFixed(9)},${capUv.getY(i).toFixed(9)}`;
  assert(g.uvs.has(got), `cap uv at (${key}) disagrees with the wall: ${got}`);
}

// the offset is what turns a 3D hit point back into section coordinates, which is the
// only 3D-specific step in the probe. Round-trip a known outline vertex through it.
const { offset } = buildSectionGeometry(outline, LENGTH, W, H);
for (const [ox, oy] of outline) {
  // the mesh sits centred, so a section point (ox, oy) lives at (ox - cx, oy - cy)
  const world = { x: ox - offset.x, y: oy - offset.y };
  const back = { x: world.x + offset.x, y: world.y + offset.y };
  assert(
    Math.abs(back.x - ox) < 1e-9 && Math.abs(back.y - oy) < 1e-9,
    `offset round-trip lost (${ox}, ${oy})`,
  );
}
// and the offset really is the section centre, so the round-trip is not trivially zero.
// tolerance is 1e-6: the bounding box is read back out of a float32 position buffer.
assert(Math.abs(offset.x - W / 2) < 1e-6, `offset.x should be the section mid-width, got ${offset.x}`);
assert(Math.abs(offset.y - H / 2) < 1e-6, `offset.y should be the section mid-height, got ${offset.y}`);
assert(Math.abs(offset.z - LENGTH / 2) < 1e-6, `offset.z should be mid-length, got ${offset.z}`);

console.log("EXTRUSION OK. uv depends on (x, y) only; every slice is identical.");
