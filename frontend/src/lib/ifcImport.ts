// ifc import: parse file, extract prismatic cross-section outline
// constraints by design: prismatic single-loop elements only, reject rest
import type * as WebIFCNamespace from "web-ifc";

export interface IfcImportedElement {
  outline: [number, number][]; // metres, min-corner at 0,0, CCW
  length_m: number; // extrusion length along long axis
  name: string;
  ifcType: string;
}

export type IfcImportOutcome =
  | { ok: true; element: IfcImportedElement }
  | { ok: false; error: string };

// structural types we try to import, in preference order
const WANTED_TYPES = ["IFCBEAM", "IFCCOLUMN", "IFCSLAB", "IFCWALLSTANDARDCASE", "IFCWALL", "IFCMEMBER"];

// cross-section areas must match across slices within this fraction
const PRISM_AREA_TOL = 0.02;
// extrusion axis must dominate bbox by this ratio, else direction ambiguous
const AXIS_RATIO_MIN = 1.5;

// collect transformed triangles for one element
function getElementTriangles(
  ifcAPI: WebIFCNamespace.IfcAPI,
  modelID: number,
  expressID: number
): number[][][] {
  const tris: number[][][] = [];
  ifcAPI.StreamAllMeshes(modelID, (flatMesh: WebIFCNamespace.FlatMesh) => {
    if (flatMesh.expressID !== expressID) return;
    for (let g = 0; g < flatMesh.geometries.size(); g++) {
      const placed = flatMesh.geometries.get(g);
      const geom = ifcAPI.GetGeometry(modelID, placed.geometryExpressID);
      // vertex buffer: pos xyz + normal xyz per vertex
      const vts = ifcAPI.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const ind = ifcAPI.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const m = placed.flatTransformation;
      const tv = new Float32Array((vts.length / 6) * 3);
      for (let i = 0; i < vts.length / 6; i++) {
        const o = i * 6;
        const x = vts[o], y = vts[o + 1], z = vts[o + 2];
        const t = i * 3;
        tv[t] = m[0] * x + m[4] * y + m[8] * z + m[12];
        tv[t + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        tv[t + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      for (let i = 0; i < ind.length; i += 3) {
        const a = ind[i] * 3, b = ind[i + 1] * 3, c = ind[i + 2] * 3;
        tris.push([
          [tv[a], tv[a + 1], tv[a + 2]],
          [tv[b], tv[b + 1], tv[b + 2]],
          [tv[c], tv[c + 1], tv[c + 2]],
        ]);
      }
      geom.delete();
    }
  });
  return tris;
}

// slice triangle soup with plane axis=coord, return 2D segments on plane
function sliceTriangles(tris: number[][][], axis: number, coord: number): number[][][] {
  const segs: number[][][] = [];
  const EPS = 1e-9;
  for (const [p0, p1, p2] of tris) {
    const d = [p0[axis] - coord, p1[axis] - coord, p2[axis] - coord];
    const pos = d.filter((v) => v > EPS).length;
    const neg = d.filter((v) => v < -EPS).length;
    if (pos === 3 || neg === 3 || pos + neg < 2) continue;
    const pts: number[][] = [];
    const edges = [[0, 1], [1, 2], [2, 0]];
    const P = [p0, p1, p2];
    for (const [a, b] of edges) {
      if ((d[a] > EPS && d[b] < -EPS) || (d[a] < -EPS && d[b] > EPS)) {
        const t = d[a] / (d[a] - d[b]);
        pts.push([
          P[a][0] + t * (P[b][0] - P[a][0]),
          P[a][1] + t * (P[b][1] - P[a][1]),
          P[a][2] + t * (P[b][2] - P[a][2]),
        ]);
      }
    }
    if (pts.length === 2) segs.push([pts[0], pts[1]]);
  }
  return segs;
}

// chain segments into closed loops; key on the two non-axis coords
function chainLoops(segs: number[][][], axis: number): number[][][] {
  const Q = 1e5; // quantize to 0.01 mm
  const co = [0, 1, 2].filter((k) => k !== axis);
  const key = (p: number[]) => `${Math.round(p[co[0]] * Q)},${Math.round(p[co[1]] * Q)}`;
  const adj = new Map<string, { other: string; used: boolean; p: number[] }[]>();
  const addEdge = (k1: string, k2: string, p: number[]) => {
    if (!adj.has(k1)) adj.set(k1, []);
    adj.get(k1)!.push({ other: k2, used: false, p });
  };
  for (const s of segs) {
    const k1 = key(s[0]), k2 = key(s[1]);
    if (k1 === k2) continue;
    addEdge(k1, k2, s[0]);
    addEdge(k2, k1, s[1]);
  }
  const loops: number[][][] = [];
  for (const [startK] of adj) {
    while (adj.get(startK)!.some((e) => !e.used)) {
      const loop: number[][] = [];
      let cur = startK;
      let guard = 0;
      while (guard++ < 200000) {
        const e = adj.get(cur)!.find((x) => !x.used);
        if (!e) break;
        e.used = true;
        const rev = adj.get(e.other)!.find((x) => x.other === cur && !x.used);
        if (rev) rev.used = true;
        loop.push(e.p);
        cur = e.other;
        if (cur === startK) break;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

// drop collinear points, repeat until stable (fixes spike's start-edge bug)
function simplifyLoop(loop: [number, number][]): [number, number][] {
  let pts: [number, number][] = loop;
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    const out: [number, number][] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const scale = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (Math.abs(cross) > 1e-7 * Math.max(scale, 1e-6)) {
        out.push(b);
      } else {
        changed = true;
      }
    }
    pts = out;
    if (!changed || pts.length < 4) break;
  }
  return pts;
}

// signed shoelace area of 2D loop
function loopArea(loop: number[][]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// project 3D loop to 2D, recenter min corner to origin, force CCW
// heuristic flip: fat side of section goes to TOP (matches T-beam convention)
function normalizeLoop(loop3: number[][], axis: number): [number, number][] {
  const co = [0, 1, 2].filter((k) => k !== axis);
  let pts = loop3.map((p) => [p[co[0]], p[co[1]]] as [number, number]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  pts = pts.map(([x, y]) => [x - x0, y - y0]);
  const h = Math.max(...pts.map((p) => p[1]));
  // horizontal edge length above vs below mid-height — wider part should sit high
  let lowerRun = 0;
  let upperRun = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (Math.abs(a[1] - b[1]) > 1e-6) continue;
    const run = Math.abs(b[0] - a[0]);
    if ((a[1] + b[1]) / 2 < h / 2) lowerRun += run;
    else upperRun += run;
  }
  if (lowerRun > upperRun * 1.0001) pts = pts.map(([x, y]) => [x, h - y]);
  if (loopArea(pts) < 0) pts.reverse();
  return pts;
}

// extract single prismatic outline from element triangles, or reject with reason
function extractFromTriangles(
  tris: number[][][],
  label: string
): { ok: true; outline: [number, number][]; length_m: number } | { ok: false; error: string } {
  if (tris.length < 4) return { ok: false, error: `${label}: no usable geometry` };

  // bbox + axis pick: extrusion along LONGEST axis; reject ambiguous blobs
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of t) {
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], p[k]);
        mx[k] = Math.max(mx[k], p[k]);
      }
    }
  }
  const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const axis = ext.indexOf(Math.max(...ext));
  const minExt = Math.min(...ext);
  if (ext[axis] / Math.max(minExt, 1e-9) < AXIS_RATIO_MIN) {
    return {
      ok: false,
      error: `${label}: extrusion direction ambiguous (bbox ${ext.map((e) => e.toFixed(2)).join("×")} m, near-cubic) — prismatic assumption not safe`,
    };
  }
  const length_m = ext[axis];

  // slice at 25/50/75%, each must yield exactly ONE closed loop
  let refArea = -1;
  let midLoop: number[][] | null = null;
  for (const frac of [0.25, 0.5, 0.75]) {
    const coord = mn[axis] + frac * length_m;
    const segs = sliceTriangles(tris, axis, coord);
    const loops = chainLoops(segs, axis);
    if (loops.length === 0) {
      return { ok: false, error: `${label}: slice at ${frac * 100}% produced no closed boundary — geometry not a clean solid` };
    }
    if (loops.length > 1) {
      return { ok: false, error: `${label}: element has openings at the ${frac * 100}% slice (${loops.length} loops) — not supported` };
    }
    const a = Math.abs(loopArea(loops[0].map((p) => {
      const c = [p[0], p[1], p[2]];
      c.splice(axis, 1);
      return c;
    })));
    if (refArea < 0) refArea = a;
    else if (Math.abs(a - refArea) / refArea > PRISM_AREA_TOL) {
      return {
        ok: false,
        error: `${label}: cross-section area changes along length (non-prismatic, taper or slope) — not supported`,
      };
    }
    if (frac === 0.5) midLoop = loops[0];
  }

  const outline = simplifyLoop(normalizeLoop(midLoop!, axis));
  if (outline.length < 3) return { ok: false, error: `${label}: degenerate outline after simplification` };
  return { ok: true, outline, length_m };
}

// lazy-load web-ifc so page bundle stays lean until user imports
let webIfcModule: typeof WebIFCNamespace | null = null;

async function loadIfcApi(): Promise<WebIFCNamespace.IfcAPI> {
  const WebIFC = await import("web-ifc");
  webIfcModule = WebIFC;
  const ifcAPI = new WebIFC.IfcAPI();
  // browser: wasm served from /web-ifc.wasm (public/); node: bundled path
  if (typeof window !== "undefined") ifcAPI.SetWasmPath("/", true);
  await ifcAPI.Init();
  return ifcAPI;
}

// parse ifc bytes, find first prismatic structural element, extract outline
export async function importIfcOutline(
  data: ArrayBuffer
): Promise<IfcImportOutcome> {
  let ifcAPI: WebIFCNamespace.IfcAPI;
  try {
    ifcAPI = await loadIfcApi();
  } catch {
    return { ok: false, error: "failed to initialise IFC engine (wasm load)" };
  }

  let modelID: number;
  try {
    modelID = ifcAPI.OpenModel(new Uint8Array(data));
  } catch {
    return { ok: false, error: "not a parseable IFC file" };
  }

  try {
    // first error message wins if nothing imports
    let firstError: string | null = null;
    for (const typeName of WANTED_TYPES) {
      const type = (webIfcModule as unknown as Record<string, number>)[typeName];
      if (!type) continue;
      const ids = ifcAPI.GetLineIDsWithType(modelID, type);
      for (let i = 0; i < ids.size(); i++) {
        const id = ids.get(i);
        const tris = getElementTriangles(ifcAPI, modelID, id);
        if (!tris.length) continue;
        const label = `${typeName.replace(/^IFC/, "Ifc")} #${id}`;
        const res = extractFromTriangles(tris, label);
        if (res.ok) {
          let name = label;
          try {
            const props = await ifcAPI.properties.getItemProperties(modelID, id, false);
            if (props?.Name?.value) name = `${props.Name.value} (${label})`;
          } catch { /* name optional */ }
          return { ok: true, element: { outline: res.outline, length_m: res.length_m, name, ifcType: typeName } };
        }
        if (!firstError) firstError = res.error;
      }
    }
    return {
      ok: false,
      error: firstError ?? "no structural elements (beam/column/slab/wall) with geometry found in file",
    };
  } finally {
    ifcAPI.CloseModel(modelID);
    ifcAPI.Dispose();
  }
}
