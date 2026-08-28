// The shapes the solver can actually rasterise, and the outline for each one.
//
// This file is a MIRROR of backend/physics/geometry.py: SHAPES, the dimension keys
// outline() reads, and the vertex order it emits. It has to be, because the preview
// drawn here before a solve returns has to be the same polygon that comes back in
// outline_m afterwards - a preview that quietly differs is a drawing of a section
// nobody is going to pour.
//
// Dimensions are millimetres on the wire (dims_mm), metres in the outline. That split
// is the backend's, kept rather than smoothed over.

export type ShapeId =
  | "slab"
  | "wall"
  | "rect_column"
  | "circular_column"
  | "beam"
  | "t_section"
  | "i_section"
  | "l_section";

export type Outline = [number, number][];

/** One editable dimension of a shape. Bounds are the slider's, in millimetres. */
export interface DimSpec {
  /** the key physics.geometry.outline() reads out of dims_mm */
  key: string;
  label: string;
  min_mm: number;
  max_mm: number;
  default_mm: number;
}

export interface ShapeDef {
  id: ShapeId;
  label: string;
  /** what the solver does with this shape's boundary, in one line. */
  note: string;
  dims: DimSpec[];
}

// Every shape the backend accepts, with the dimension keys it requires. Nothing here
// is a display alias: `key` is sent verbatim.
export const SHAPE_DEFS: ShapeDef[] = [
  {
    id: "slab",
    label: "Slab",
    note: "Sides are symmetry planes — a strip of a wider pour, so width cannot change the answer.",
    dims: [
      { key: "width", label: "Width", min_mm: 300, max_mm: 100000, default_mm: 3000 },
      { key: "thickness", label: "Thickness", min_mm: 50, max_mm: 100000, default_mm: 300 },
    ],
  },
  {
    id: "wall",
    label: "Wall",
    note: "Both faces formed, top exposed.",
    dims: [
      { key: "thickness", label: "Thickness", min_mm: 100, max_mm: 100000, default_mm: 300 },
      { key: "height", label: "Height", min_mm: 300, max_mm: 100000, default_mm: 2400 },
    ],
  },
  {
    id: "rect_column",
    label: "Rectangular column",
    note: "Four formed faces. Equal width and depth gives a square.",
    dims: [
      { key: "width", label: "Width", min_mm: 150, max_mm: 100000, default_mm: 400 },
      { key: "height", label: "Depth", min_mm: 150, max_mm: 100000, default_mm: 400 },
    ],
  },
  {
    id: "circular_column",
    label: "Circular column",
    note: "Rasterised from a 128-segment circle.",
    dims: [{ key: "diameter", label: "Diameter", min_mm: 150, max_mm: 100000, default_mm: 600 }],
  },
  {
    id: "beam",
    label: "Rectangular beam",
    note: "Formed sides and soffit, top exposed.",
    dims: [
      { key: "width", label: "Width", min_mm: 150, max_mm: 100000, default_mm: 300 },
      { key: "height", label: "Depth", min_mm: 200, max_mm: 100000, default_mm: 600 },
    ],
  },
  {
    id: "t_section",
    label: "T-section",
    note: "Flange on top. Soffits under it are tagged formed, not ground.",
    dims: [
      { key: "flange_width", label: "Flange width", min_mm: 200, max_mm: 100000, default_mm: 900 },
      { key: "flange_thickness", label: "Flange depth", min_mm: 50, max_mm: 100000, default_mm: 150 },
      { key: "web_width", label: "Web width", min_mm: 80, max_mm: 100000, default_mm: 300 },
      { key: "height", label: "Total depth", min_mm: 200, max_mm: 100000, default_mm: 750 },
    ],
  },
  {
    id: "i_section",
    label: "I-section",
    note: "Symmetric double-tee. Top flange exposed, everything else formed.",
    dims: [
      { key: "flange_width", label: "Flange width", min_mm: 200, max_mm: 100000, default_mm: 600 },
      { key: "flange_thickness", label: "Flange depth", min_mm: 50, max_mm: 100000, default_mm: 120 },
      { key: "web_width", label: "Web width", min_mm: 80, max_mm: 100000, default_mm: 180 },
      { key: "height", label: "Total depth", min_mm: 300, max_mm: 100000, default_mm: 800 },
    ],
  },
  {
    id: "l_section",
    label: "L-section",
    note: "Ledger beam. The upstand is one leg thickness wide.",
    dims: [
      { key: "width", label: "Width", min_mm: 200, max_mm: 100000, default_mm: 600 },
      { key: "height", label: "Height", min_mm: 200, max_mm: 100000, default_mm: 600 },
      { key: "leg_thickness", label: "Leg thickness", min_mm: 50, max_mm: 100000, default_mm: 150 },
    ],
  },
];

export const SHAPE_BY_ID: Record<ShapeId, ShapeDef> = Object.fromEntries(
  SHAPE_DEFS.map((d) => [d.id, d]),
) as Record<ShapeId, ShapeDef>;

// how many segments physics.geometry approximates a circle with. Same number here so a
// circular column's preview and its solved outline have the same vertices.
const CIRCLE_SEGMENTS = 128;

// axis-aligned rectangle anchored at the origin, same winding as geometry._rect.
function rect(w_m: number, h_m: number): Outline {
  return [
    [0, 0],
    [w_m, 0],
    [w_m, h_m],
    [0, h_m],
  ];
}

/**
 * Shape plus millimetre dims in, closed outline polygon in metres out.
 *
 * Line-for-line the same construction as physics.geometry.outline. A missing key
 * returns null rather than NaN vertices: an incomplete form is a normal state while
 * the user is still typing, and a polygon full of NaN silently paints nothing.
 */
export function outlineFor(shape: ShapeId, dims_mm: Record<string, number>): Outline | null {
  const mm = (key: string): number => dims_mm[key] / 1000;
  const has = (...keys: string[]) =>
    keys.every((k) => Number.isFinite(dims_mm[k]) && dims_mm[k] > 0);

  if (shape === "slab") {
    if (!has("width", "thickness")) return null;
    return rect(mm("width"), mm("thickness"));
  }
  if (shape === "wall") {
    if (!has("thickness", "height")) return null;
    return rect(mm("thickness"), mm("height"));
  }
  if (shape === "rect_column" || shape === "beam") {
    if (!has("width", "height")) return null;
    return rect(mm("width"), mm("height"));
  }
  if (shape === "circular_column") {
    if (!has("diameter")) return null;
    const r = mm("diameter") / 2;
    return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
      const t = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
      return [r + r * Math.cos(t), r + r * Math.sin(t)] as [number, number];
    });
  }
  if (shape === "t_section") {
    if (!has("flange_width", "flange_thickness", "web_width", "height")) return null;
    const fw = mm("flange_width");
    const ft = mm("flange_thickness");
    const ww = mm("web_width");
    const h = mm("height");
    const a = (fw - ww) / 2;
    const b = (fw + ww) / 2;
    const y = h - ft;
    return [
      [a, 0],
      [b, 0],
      [b, y],
      [fw, y],
      [fw, h],
      [0, h],
      [0, y],
      [a, y],
    ];
  }
  if (shape === "i_section") {
    if (!has("flange_width", "flange_thickness", "web_width", "height")) return null;
    const fw = mm("flange_width");
    const ft = mm("flange_thickness");
    const ww = mm("web_width");
    const h = mm("height");
    const a = (fw - ww) / 2;
    const b = (fw + ww) / 2;
    return [
      [0, 0],
      [fw, 0],
      [fw, ft],
      [b, ft],
      [b, h - ft],
      [fw, h - ft],
      [fw, h],
      [0, h],
      [0, h - ft],
      [a, h - ft],
      [a, ft],
      [0, ft],
    ];
  }
  if (shape === "l_section") {
    if (!has("width", "height", "leg_thickness")) return null;
    const w = mm("width");
    const h = mm("height");
    const t = mm("leg_thickness");
    return [
      [0, 0],
      [w, 0],
      [w, t],
      [t, t],
      [t, h],
      [0, h],
    ];
  }
  return null;
}

/**
 * Clamp dims so the polygon stays a valid solid.
 *
 * The backend does not do this - it would happily rasterise a T whose web is wider
 * than its flange into a shape nobody meant. Doing it here keeps a mid-drag slider
 * from ever sending a self-intersecting section over the wire.
 */
export function clampDims(shape: ShapeId, dims_mm: Record<string, number>): Record<string, number> {
  const out = { ...dims_mm };
  const def = SHAPE_BY_ID[shape];
  for (const d of def.dims) {
    const v = Number(out[d.key]);
    out[d.key] = Math.min(Math.max(Number.isFinite(v) ? v : d.default_mm, d.min_mm), d.max_mm);
  }
  if (shape === "t_section" || shape === "i_section") {
    out.web_width = Math.min(out.web_width, out.flange_width);
    // an I needs room between its two flanges; a T only needs room under its one.
    const flangeRoom = shape === "i_section" ? 2 : 1;
    out.flange_thickness = Math.min(out.flange_thickness, (out.height * 0.9) / flangeRoom);
  }
  if (shape === "l_section") {
    out.leg_thickness = Math.min(out.leg_thickness, out.width * 0.9, out.height * 0.9);
  }
  return out;
}

/** Bounding box of an outline, metres. */
export function outlineExtent(outline: Outline): { w_m: number; h_m: number } {
  return {
    w_m: Math.max(...outline.map((p) => p[0])),
    h_m: Math.max(...outline.map((p) => p[1])),
  };
}

/** Signed-area (shoelace) magnitude of a polygon, m². The true section area. */
export function polygonArea_m2(outline: Outline): number {
  let twice = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}
