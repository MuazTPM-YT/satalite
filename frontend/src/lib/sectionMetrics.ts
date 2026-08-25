// Measurements taken off the solved section polygon.
//
// Two questions get answered here, and both are asked of the OUTLINE the backend
// returned, never of a shape rebuilt from the input boxes: how far is this probe from
// the concrete's edges and corners, and how much concrete does a section cut remove.
//
// Everything is metres and square/cubic metres. Nothing rounds - formatting is the
// caller's job, because the same number gets shown in five different units.
import type { Outline } from "@/lib/shapes";

/** Which way a face looks, taken from the polygon's own outward normal. */
export type Facing = "top" | "soffit" | "left" | "right" | "skew";

/**
 * One edge of the section, named and oriented.
 *
 * This half of an edge depends only on the polygon, so the LABEL LAYER can be drawn
 * without a probe: the letters on the section are a property of the section, not of
 * wherever the reader happened to click last.
 */
export interface EdgeFeature {
  /** index of the polygon edge, so a caller can highlight the one it means */
  index: number;
  /** which way the edge runs, for a human-readable label */
  orientation: "horizontal" | "vertical" | "skew";
  /**
   * The edge's name on the drawing: A, B, C … derived from `index` alone, so the
   * letter beside a distance in the readout is the letter drawn on that edge of the
   * section. "Edge 3" told a reader nothing about WHICH line it meant.
   */
  tag: string;
  /** which way this face looks, so the tag can be read without hunting for it */
  facing: Facing;
  /** the segment's two ends, metres — what a caller draws to point at this edge */
  from: [number, number];
  to: [number, number];
  /** unit outward normal, for placing the tag on the outside of the section */
  normal: [number, number];
  /** the segment's midpoint, metres — where a label with no probe to aim at sits */
  mid: [number, number];
}

export interface EdgeDistance extends EdgeFeature {
  /** perpendicular distance to the segment, metres */
  distance_m: number;
  /** the closest point ON that edge, metres */
  at: [number, number];
}

/** The letter drawn on edge `i`. Past Z it carries a digit rather than repeating. */
export function edgeTag(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  const wrap = Math.floor(index / 26);
  return wrap === 0 ? letter : `${letter}${wrap}`;
}

/** How a facing reads in a sentence. Concrete's own words, not compass directions. */
export const FACING_LABEL: Record<Facing, string> = {
  top: "top face",
  soffit: "soffit",
  left: "left face",
  right: "right face",
  skew: "sloped face",
};

export interface CornerFeature {
  index: number;
  at: [number, number];
  /**
   * The corner's name on the drawing: 1, 2, 3 … derived from `index` alone, the same
   * way `tag` names an edge. The readout used to print "Corner 3" from the array
   * position after sorting by distance, which is a different number every time the
   * probe moves and matches nothing drawn anywhere.
   */
  tag: string;
  /**
   * Unit vector pointing OUT of the section at this vertex — the average of the two
   * adjoining edge normals. It is where the corner's number goes, so the digit sits
   * clear of the concrete instead of on top of it.
   */
  normal: [number, number];
}

export interface CornerDistance extends CornerFeature {
  distance_m: number;
}

/** The number drawn on corner `i`. One-based, because drawings are. */
export function cornerTag(index: number): string {
  return String(index + 1);
}

export interface ProbeGeometry {
  /** every edge, nearest first */
  edges: EdgeDistance[];
  /** every corner, nearest first */
  corners: CornerDistance[];
  /** distance to the nearest face of any kind. This is the concrete cover. */
  cover_m: number;
  /** distance to each side of the section's bounding box */
  bbox: { left_m: number; right_m: number; bottom_m: number; top_m: number };
  /** the section's overall size, for context next to the distances */
  extent: { w_m: number; h_m: number };
}

// closest point on segment ab to p, plus the distance to it.
function closestOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { at: [number, number]; distance_m: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  // a degenerate edge is a point; clamping t to 0 gives exactly that.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
  const at: [number, number] = [a[0] + t * vx, a[1] + t * vy];
  return { at, distance_m: Math.hypot(p[0] - at[0], p[1] - at[1]) };
}

// which way an edge runs. Exact equality is right here: every preset outline is
// axis-aligned by construction, and a circle's chords are genuinely skew.
function orientationOf(a: [number, number], b: [number, number]): EdgeDistance["orientation"] {
  if (a[1] === b[1]) return "horizontal";
  if (a[0] === b[0]) return "vertical";
  return "skew";
}

/** Twice the signed area. Positive means the outline winds counter-clockwise. */
function signedArea2(outline: Outline): number {
  let twice = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    twice += x1 * y2 - x2 * y1;
  }
  return twice;
}

// Which way an edge FACES, from the outward normal of the segment.
//
// The normal's sign depends on the winding, so the winding is measured rather than
// assumed: geometry.py emits counter-clockwise polygons today, and a facing that
// silently inverts if that ever changes would label every soffit a top face.
function outwardNormal(
  a: [number, number],
  b: [number, number],
  ccw: boolean,
): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  // outward normal of a CCW polygon is (dy, -dx); clockwise flips it.
  const nx = ccw ? dy : -dy;
  const ny = ccw ? -dx : dx;
  const len = Math.hypot(nx, ny);
  return len === 0 ? [0, 0] : [nx / len, ny / len];
}

function facingOf(normal: [number, number]): Facing {
  const [nx, ny] = normal;
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12) return "skew";
  // a chord of a circle is genuinely diagonal; a 45 degree tolerance would call it
  // a "top face" and mean nothing by it.
  const ratio = Math.abs(nx) / (Math.abs(ny) + 1e-15);
  if (ratio > 8) return nx > 0 ? "right" : "left";
  if (ratio < 0.125) return ny > 0 ? "top" : "soffit";
  return "skew";
}

/**
 * The section's own edges and corners, in polygon order.
 *
 * No probe involved: this is what the label layer draws. Both viewers call it, so a
 * letter means the same edge in the 2D sheet and in the 3D scene by construction
 * rather than by two implementations agreeing.
 */
export function sectionFeatures(outline: Outline): {
  edges: EdgeFeature[];
  corners: CornerFeature[];
} {
  const ccw = signedArea2(outline) > 0;
  const n = outline.length;

  const edges: EdgeFeature[] = outline.map((a, i) => {
    const b = outline[(i + 1) % n];
    const normal = outwardNormal(a, b, ccw);
    return {
      index: i,
      orientation: orientationOf(a, b),
      tag: edgeTag(i),
      facing: facingOf(normal),
      from: [a[0], a[1]] as [number, number],
      to: [b[0], b[1]] as [number, number],
      normal,
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number],
    };
  });

  // A vertex's outward direction is the average of the two edges meeting there. On a
  // right angle that is the diagonal, which is exactly where the number belongs.
  const corners: CornerFeature[] = outline.map((c, i) => {
    const prev = edges[(i - 1 + n) % n].normal;
    const next = edges[i].normal;
    const nx = prev[0] + next[0];
    const ny = prev[1] + next[1];
    const len = Math.hypot(nx, ny);
    return {
      index: i,
      at: [c[0], c[1]] as [number, number],
      tag: cornerTag(i),
      normal: (len === 0 ? [0, 0] : [nx / len, ny / len]) as [number, number],
    };
  });

  return { edges, corners };
}

/** Every edge and corner distance from one point, nearest first. */
export function probeGeometry(outline: Outline, point: [number, number]): ProbeGeometry {
  const { edges: features, corners: vertices } = sectionFeatures(outline);

  const edges: EdgeDistance[] = features.map((e) => {
    const { at, distance_m } = closestOnSegment(point, e.from, e.to);
    return { ...e, at, distance_m };
  });

  const corners: CornerDistance[] = vertices.map((c) => ({
    ...c,
    distance_m: Math.hypot(point[0] - c.at[0], point[1] - c.at[1]),
  }));

  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const byDistance = <T extends { distance_m: number }>(list: T[]) =>
    [...list].sort((p, q) => p.distance_m - q.distance_m);

  return {
    edges: byDistance(edges),
    corners: byDistance(corners),
    cover_m: Math.min(...edges.map((e) => e.distance_m)),
    bbox: {
      left_m: point[0] - minX,
      right_m: maxX - point[0],
      bottom_m: point[1] - minY,
      top_m: maxY - point[1],
    },
    extent: { w_m: maxX - minX, h_m: maxY - minY },
  };
}

export interface CutMetrics {
  /** where the cut plane sits along the length, metres from the near end */
  at_m: number;
  length_m: number;
  /** fraction of the length still shown, 0-1 */
  kept_frac: number;
  /** area of the exposed cut face, m². This is the cross-section area. */
  face_area_m2: number;
  /** volume still on screen, m³ */
  kept_volume_m3: number;
  /** volume the cut took away, m³ */
  removed_volume_m3: number;
  total_volume_m3: number;
  /** the cut face's perimeter, m - what a formwork take-off needs */
  face_perimeter_m: number;
  /** mass of the removed piece at the solver's own concrete density */
  removed_mass_kg: number;
}

// the solver's rho_kg_m3 default (physics.constants.RHO_DEFAULT). Mass is a convenience
// on top of volume, so it uses the same density the heat solve assumed rather than a
// second, different, "typical concrete" number.
export const RHO_KG_M3 = 2400;

/**
 * What a section cut actually removed.
 *
 * The face area comes from the MASK when a solved field is available - that is the
 * area the solver ran on, holes and rasterisation included - and falls back to the
 * outline's shoelace area when it is not. The two agree to within one cell ring.
 */
export function cutMetrics(
  outline: Outline,
  length_m: number,
  kept_frac: number,
  maskArea_m2?: number,
): CutMetrics {
  let twice = 0;
  let perimeter = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    twice += x1 * y2 - x2 * y1;
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  const face_area_m2 = maskArea_m2 ?? Math.abs(twice) / 2;

  const frac = Math.min(Math.max(kept_frac, 0), 1);
  const total_volume_m3 = face_area_m2 * length_m;
  const kept_volume_m3 = total_volume_m3 * frac;

  return {
    at_m: length_m * frac,
    length_m,
    kept_frac: frac,
    face_area_m2,
    kept_volume_m3,
    removed_volume_m3: total_volume_m3 - kept_volume_m3,
    total_volume_m3,
    face_perimeter_m: perimeter,
    removed_mass_kg: (total_volume_m3 - kept_volume_m3) * RHO_KG_M3,
  };
}

/** Concrete area of a solved frame, from the cells that hold a temperature. */
export function maskArea_m2(frame: (number | null)[][], dx_m: number): number {
  let cells = 0;
  for (const row of frame) for (const v of row) if (v !== null) cells++;
  return cells * dx_m * dx_m;
}

/* ── orthographic elevations ─────────────────────────────────────────────────── */

/** One lengthwise edge of the extrusion, as an elevation sees it. */
export interface ElevationLine {
  /** where the line sits on the elevation's cross-section axis, metres */
  at_m: number;
  /** true when concrete nearer the viewer stands in front of it */
  hidden: boolean;
}

// Where the section's boundary sits along `otherAxis` on the scanline `axis = at`.
// Half-open crossing test, so an edge lying exactly along the scanline contributes
// nothing rather than dividing by zero.
function boundaryAt(
  outline: Outline,
  axis: 0 | 1,
  at: number,
): { lo: number; hi: number } | null {
  const other = axis === 0 ? 1 : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const a0 = a[axis];
    const b0 = b[axis];
    if ((a0 <= at) === (b0 <= at)) continue;
    const t = (at - a0) / (b0 - a0);
    const v = a[other] + t * (b[other] - a[other]);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? null : { lo, hi };
}

/**
 * The lengthwise edges an elevation of this prismatic element sees.
 *
 * Every vertex of the cross-section sweeps an edge along the length, and in an
 * elevation that edge projects to a single line across the whole drawing. Whether
 * the line is drawn solid or dashed is the ordinary orthographic-projection
 * question: an edge is VISIBLE when the silhouette on the viewer's side actually
 * steps there, and HIDDEN when the silhouette is unchanged across it - which means
 * concrete nearer the viewer covers it. The top of an L's leg, seen from the left,
 * is the textbook case: the upstand is in front of it, so it is dashed.
 *
 * `axis` is the section coordinate the elevation's cross-section screen axis reads
 * (0 = x for a plan, 1 = y for a side elevation). `from` is the side the viewer
 * stands on along the other coordinate.
 *
 * The two outer silhouette lines are left out: the sheet already draws them as the
 * element's own outline, and a second line on top of them is just a heavier line.
 */
export function elevationLines(
  outline: Outline,
  axis: 0 | 1,
  from: "min" | "max",
): ElevationLine[] {
  if (outline.length < 3) return [];
  const values = outline.map((p) => p[axis]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // 0.01 mm: finer than any dimension the panel can send, coarse enough that a
  // scanline never lands exactly on the vertex it is asking about.
  const EPS = 1e-5;
  const TOL = 1e-9;

  const seen = new Set<string>();
  const out: ElevationLine[] = [];
  for (const at of values) {
    if (at - lo < EPS || hi - at < EPS) continue;
    const key = at.toFixed(6);
    if (seen.has(key)) continue;
    seen.add(key);
    const below = boundaryAt(outline, axis, at - EPS);
    const above = boundaryAt(outline, axis, at + EPS);
    // one side empty is a genuine step: the concrete starts or stops here.
    if (!below || !above) {
      out.push({ at_m: at, hidden: false });
      continue;
    }
    const edgeOf = (s: { lo: number; hi: number }) => (from === "min" ? s.lo : s.hi);
    out.push({ at_m: at, hidden: Math.abs(edgeOf(below) - edgeOf(above)) < TOL });
  }
  return out.sort((a, b) => a.at_m - b.at_m);
}
