// The 2D sheet.
//
// Geometry from outline_m, colour from the per-cell field, probe sampled the same way
// the backend samples its own. Nothing here is drawn from the input boxes.
//
// Six orthographic views, and all six are honest about the same fact: the solver is 2D
// because the element is prismatic, so T is a function of (x, y) and never of z. The
// section view shows that field directly. The four elevations show the FACE the viewer
// is looking at - each stripe is the temperature of the outermost solved cell in that
// row or column - which is why they are striped rather than shaded: there is nothing
// varying along the length to shade.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SimulationResult } from "@/lib/api";
import { sampleField, frameRange, type Frame, type Sample } from "@/lib/probe";
import { tempToColor } from "@/lib/thermalColormap";
import { elevationLines, probeGeometry } from "@/lib/sectionMetrics";
import ThermalLegend from "@/components/ThermalLegend";
import ProbeCard from "@/components/ProbeCard";
import { Maximize2, Minus, Plus, SquareDashed, Target, X } from "lucide-react";
import { Toolbar, ToolbarButton, ToolbarDivider, ToolbarToggle, Flag, cx } from "@/components/ui";
import { ScrubField } from "@/components/fields";
import { fmtLen, type LengthUnit } from "@/lib/units";

// discrete contour band width. 2D is stepped on purpose; 3D stays smooth.
const BAND_STEP_C = 5;

// The sheet's margins, in real screen pixels.
//
// The svg's viewBox is the CONTAINER's own pixel box, so one user unit is one css
// pixel and a dimension label is 11px whatever the element's aspect ratio. A fixed
// viewBox letterboxed instead: an 0.6 x 0.8 I-section fitted into a wide viewer at
// 0.45x, which took the annotation down to five pixels and made it unreadable.
//
// Top clears the view switcher AND the width dimension drawn above the sheet; bottom
// clears the control strip and the two lines of metadata above it. Left is where the
// depth dimension goes. A tall section pins the drawing to the top margin exactly, so
// these have to be big enough for the annotation, not just for the chrome.
const MARGIN = { left: 104, top: 112, right: 40, bottom: 112 };
// what the sheet falls back to before the container has been measured. Any positive
// number works; this one just keeps the first paint from being degenerate.
const FALLBACK_BOX = { w: 900, h: 460 };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 24;

export type ViewId = "front" | "back" | "left" | "right" | "top" | "bottom";

const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "front", label: "Front", hint: "Section A-A — the solved cross-section" },
  { id: "back", label: "Back", hint: "The same section, seen from the far end" },
  { id: "left", label: "Left", hint: "Elevation on the left face, along the length" },
  { id: "right", label: "Right", hint: "Elevation on the right face, along the length" },
  { id: "top", label: "Top", hint: "Plan on the top face, along the length" },
  { id: "bottom", label: "Bottom", hint: "Plan on the soffit, along the length" },
];

interface Section2DProps {
  sim: SimulationResult;
  // index into sim.fields.times_h, NOT into sim.times_h.
  frameIndex: number;
  length_m: number;
  units: LengthUnit;
}

/** One drawable patch in view space: where it sits, and what it reads. */
interface Patch {
  u0: number;
  v0: number;
  du: number;
  dv: number;
  temp_c: number;
}

// Outermost solid cell in every row and column of a frame.
//
// This is what an elevation is looking at. Computed once per frame rather than per
// stripe, because a 12 m slab at 5 mm is 2400 columns and the scan is O(nx*ny).
function faceProfiles(frame: Frame) {
  const ny = frame.length;
  const nx = ny > 0 ? frame[0].length : 0;
  const leftCol = new Int32Array(ny).fill(-1);
  const rightCol = new Int32Array(ny).fill(-1);
  const topRow = new Int32Array(nx).fill(-1);
  const bottomRow = new Int32Array(nx).fill(-1);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (frame[j][i] === null) continue;
      if (leftCol[j] < 0) leftCol[j] = i;
      rightCol[j] = i;
      if (bottomRow[i] < 0) bottomRow[i] = j;
      topRow[i] = j;
    }
  }
  return { leftCol, rightCol, topRow, bottomRow, nx, ny };
}

// dimension line with end ticks and a label, horizontal or vertical.
function Dim({
  from,
  to,
  at,
  axis,
  label,
}: {
  from: number;
  to: number;
  at: number;
  axis: "h" | "v";
  label: string;
}) {
  const mid = (from + to) / 2;
  const common = { stroke: "currentColor", strokeWidth: 1 };
  return (
    <g className="text-text-secondary" vectorEffect="non-scaling-stroke">
      {axis === "h" ? (
        <>
          <line x1={from} y1={at} x2={to} y2={at} {...common} />
          <line x1={from} y1={at - 5} x2={from} y2={at + 5} {...common} />
          <line x1={to} y1={at - 5} x2={to} y2={at + 5} {...common} />
          <text x={mid} y={at - 7} textAnchor="middle" fontSize="11" fill="currentColor" className="tabular-nums">
            {label}
          </text>
        </>
      ) : (
        <>
          <line x1={at} y1={from} x2={at} y2={to} {...common} />
          <line x1={at - 5} y1={from} x2={at + 5} y2={from} {...common} />
          <line x1={at - 5} y1={to} x2={at + 5} y2={to} {...common} />
          <text
            x={at - 8}
            y={mid}
            textAnchor="middle"
            fontSize="11"
            fill="currentColor"
            className="tabular-nums"
            transform={`rotate(-90 ${at - 8} ${mid})`}
          >
            {label}
          </text>
        </>
      )}
    </g>
  );
}

export default function Section2D({ sim, frameIndex, length_m, units }: Section2DProps) {
  const [view, setView] = useState<ViewId>("front");
  const [opacity, setOpacity] = useState(100);
  const [showDistances, setShowDistances] = useState(false);
  // Orthographic convention, on by default: an elevation draws the lengthwise edges
  // behind the face as well as the ones on it, dashed rather than solid.
  const [showHidden, setShowHidden] = useState(true);
  // pan is in SHEET pixels, applied before the zoom, so a wheel zoom about the cursor
  // is one multiply rather than a chain of compensating translates.
  const [viewport, setViewport] = useState({ zoom: 1, tx: 0, ty: 0 });
  // `at` is where on the canvas the popup sits. Anchoring the readout to the click
  // rather than docking it in a corner is what keeps it out of the palettes' way at
  // any window size — and it is where the eye already is.
  const [probe, setProbe] = useState<{
    sample: Sample;
    section_m: [number, number];
    uv: [number, number];
    at: { x: number; y: number };
  } | null>(null);
  // mirrors dragRef.moved for the cursor. The ref is what the pointer handlers read;
  // this is the only part of it the render needs, and a ref read during render is not
  // guaranteed to have made it into the frame being painted.
  const [panning, setPanning] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  const fields = sim.fields;
  const frame = fields?.temp_c[Math.min(frameIndex, fields.temp_c.length - 1)] ?? null;
  const current_h = fields?.times_h[Math.min(frameIndex, fields.times_h.length - 1)] ?? 0;

  // Section extent from the solver's own grid, not the outline bbox: the raster is
  // what the cells are indexed against, so a cell and a vertex cannot drift apart.
  const w_m = fields ? fields.nx * fields.dx_m : Math.max(...sim.outline_m.map((p) => p[0]));
  const h_m = fields ? fields.ny * fields.dx_m : Math.max(...sim.outline_m.map((p) => p[1]));

  const profiles = useMemo(() => (frame ? faceProfiles(frame) : null), [frame]);

  // What this view is looking at: the two axes on screen, and the section point that
  // any (u, v) on screen actually reads.
  const projection = useMemo(() => {
    const dx = fields?.dx_m ?? 0.01;
    const along = { extent: length_m, label: "length" };

    switch (view) {
      case "front":
        return {
          u: { extent: w_m, label: "width" },
          v: { extent: h_m, label: "depth" },
          toSection: (u: number, v: number): [number, number] => [u, v],
        };
      case "back":
        return {
          u: { extent: w_m, label: "width" },
          v: { extent: h_m, label: "depth" },
          toSection: (u: number, v: number): [number, number] => [w_m - u, v],
        };
      case "left":
      case "right":
        return {
          u: along,
          v: { extent: h_m, label: "depth" },
          toSection: (_u: number, v: number): [number, number] | null => {
            if (!profiles) return null;
            const j = Math.min(profiles.ny - 1, Math.max(0, Math.floor(v / dx)));
            const col = view === "left" ? profiles.leftCol[j] : profiles.rightCol[j];
            return col < 0 ? null : [(col + 0.5) * dx, v];
          },
        };
      default:
        return {
          u: { extent: w_m, label: "width" },
          v: along,
          toSection: (u: number): [number, number] | null => {
            if (!profiles) return null;
            const i = Math.min(profiles.nx - 1, Math.max(0, Math.floor(u / dx)));
            const row = view === "top" ? profiles.topRow[i] : profiles.bottomRow[i];
            return row < 0 ? null : [u, (row + 0.5) * dx];
          },
        };
    }
  }, [view, w_m, h_m, length_m, profiles, fields?.dx_m]);

  const uExt = projection.u.extent;
  const vExt = projection.v.extent;

  // The viewer's own pixel box. Measured, because it is the viewBox: the sheet is
  // laid out in screen pixels so annotation stays legible at any element aspect.
  const [box, setBox] = useState(FALLBACK_BOX);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      if (r.width < 1 || r.height < 1) return;
      setBox((prev) =>
        Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev
          : { w: r.width, h: r.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const svgW = box.w;
  const svgH = box.h;
  const drawW = Math.max(80, svgW - MARGIN.left - MARGIN.right);
  const drawH = Math.max(80, svgH - MARGIN.top - MARGIN.bottom);
  const scale = Math.min(drawW / uExt, drawH / vExt);
  const sheetW = uExt * scale;
  const sheetH = vExt * scale;
  // centre the drawing inside the margins rather than pinning it to the top-left
  const originX = MARGIN.left + (drawW - sheetW) / 2;
  const originY = MARGIN.top + (drawH - sheetH) / 2;

  // view metres -> sheet px. v is flipped: the solver's row 0 is the base.
  const toPx = useCallback(
    (u: number, v: number): [number, number] => [originX + u * scale, originY + (vExt - v) * scale],
    [scale, vExt, originX, originY],
  );

  const range = useMemo(() => (frame ? frameRange(frame) : null), [frame]);

  // Fixed across the run so frames are comparable, and taken from the run's own
  // extremes rather than a hardcoded pair that could clip the very peak.
  const scaleBounds = useMemo(() => {
    if (!fields) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of fields.temp_c) {
      const r = frameRange(f);
      if (!r) continue;
      lo = Math.min(lo, r.min_c);
      hi = Math.max(hi, r.max_c);
    }
    if (lo === Infinity) return null;
    return {
      min_c: Math.floor(lo / BAND_STEP_C) * BAND_STEP_C,
      max_c: Math.ceil(hi / BAND_STEP_C) * BAND_STEP_C,
    };
  }, [fields]);

  // Every patch this view draws, in view metres. One list for all six views, so the
  // renderer below has no idea which one it is painting.
  const patches = useMemo((): Patch[] => {
    if (!fields || !frame || !profiles) return [];
    const dx = fields.dx_m;
    const { nx, ny, leftCol, rightCol, topRow, bottomRow } = profiles;
    const out: Patch[] = [];

    if (view === "front" || view === "back") {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const t = frame[j][i];
          if (t === null) continue;
          const u = view === "front" ? i * dx : (nx - 1 - i) * dx;
          out.push({ u0: u, v0: j * dx, du: dx, dv: dx, temp_c: t });
        }
      }
      return out;
    }

    if (view === "left" || view === "right") {
      for (let j = 0; j < ny; j++) {
        const col = view === "left" ? leftCol[j] : rightCol[j];
        if (col < 0) continue;
        const t = frame[j][col];
        if (t === null) continue;
        out.push({ u0: 0, v0: j * dx, du: length_m, dv: dx, temp_c: t });
      }
      return out;
    }

    for (let i = 0; i < nx; i++) {
      const row = view === "top" ? topRow[i] : bottomRow[i];
      if (row < 0) continue;
      const t = frame[row][i];
      if (t === null) continue;
      out.push({ u0: i * dx, v0: 0, du: dx, dv: length_m, temp_c: t });
    }
    return out;
  }, [view, fields, frame, profiles, length_m]);

  // Patches grouped into contour bands, one path per band.
  //
  // Two things here are not incidental.
  //
  // Runs of neighbouring cells in the same band are MERGED into one rectangle before
  // anything is drawn. On a 3 m slab that is 300 cells across and uniform in x, it
  // turns 9000 rectangles into 30 - and the merge is what makes the second point
  // possible.
  //
  // Every rectangle is emitted with ABSOLUTE corner coordinates rather than a width.
  // A rounded width accumulates: 150 cells of a 2.1333 px cell written as "2.13" land
  // half a pixel short of where cell 150 starts, and that half pixel shows up as a
  // hairline seam down an otherwise uniform section - a contour line in the drawing
  // where the data has none. Sharing the exact edge coordinate cannot leave a gap.
  const drawing = useMemo(() => {
    if (!scaleBounds || patches.length === 0) return null;
    const nBands = Math.max(1, Math.round((scaleBounds.max_c - scaleBounds.min_c) / BAND_STEP_C));
    const bandOf = (t: number) => {
      const clamped = Math.min(Math.max(t, scaleBounds.min_c), scaleBounds.max_c - 1e-9);
      return Math.min(nBands - 1, Math.floor((clamped - scaleBounds.min_c) / BAND_STEP_C));
    };

    const paths = new Map<number, string[]>();
    const push = (band: number, u0: number, u1: number, v0: number, v1: number) => {
      const [x0, y1] = toPx(u0, v0);
      const [x1, y0] = toPx(u1, v1);
      const d =
        `M${x0.toFixed(3)} ${y0.toFixed(3)}L${x1.toFixed(3)} ${y0.toFixed(3)}` +
        `L${x1.toFixed(3)} ${y1.toFixed(3)}L${x0.toFixed(3)} ${y1.toFixed(3)}Z`;
      const list = paths.get(band);
      if (list) list.push(d);
      else paths.set(band, [d]);
    };

    // patches arrive in u-then-v order within a row, which is what makes a single
    // forward pass enough to find every run.
    let run: { band: number; u0: number; u1: number; v0: number; v1: number } | null = null;
    for (const p of patches) {
      const band = bandOf(p.temp_c);
      if (
        run &&
        run.band === band &&
        run.v0 === p.v0 &&
        run.v1 === p.v0 + p.dv &&
        Math.abs(run.u1 - p.u0) < 1e-12
      ) {
        run.u1 = p.u0 + p.du;
        continue;
      }
      if (run) push(run.band, run.u0, run.u1, run.v0, run.v1);
      run = { band, u0: p.u0, u1: p.u0 + p.du, v0: p.v0, v1: p.v0 + p.dv };
    }
    if (run) push(run.band, run.u0, run.u1, run.v0, run.v1);

    const bandColor = (band: number) => {
      const mid = scaleBounds.min_c + (band + 0.5) * BAND_STEP_C;
      const [r, g, b] = tempToColor(mid, scaleBounds.min_c, scaleBounds.max_c);
      return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    };

    return {
      entries: [...paths.entries()].map(([band, ds]) => [band, ds.join("")] as const),
      bandColor,
    };
  }, [patches, scaleBounds, toPx]);

  // The silhouette. In the section views it is the solved polygon; in the elevations
  // it is the rectangle that polygon sweeps, because a prismatic element seen from
  // the side is exactly that.
  const silhouette = useMemo(() => {
    if (view === "front" || view === "back") {
      return sim.outline_m
        .map(([x, y]) => {
          const u = view === "front" ? x : w_m - x;
          return toPx(u, y).map((n) => n.toFixed(1)).join(",");
        })
        .join(" ");
    }
    if (patches.length === 0) return "";
    // A loop, not Math.min(...list): a 12 m slab at 5 mm is 144 000 patches and a
    // spread that long overflows the argument stack outright.
    let vLo = Infinity;
    let vHi = -Infinity;
    let uLo = Infinity;
    let uHi = -Infinity;
    for (const p of patches) {
      if (p.v0 < vLo) vLo = p.v0;
      if (p.v0 + p.dv > vHi) vHi = p.v0 + p.dv;
      if (p.u0 < uLo) uLo = p.u0;
      if (p.u0 + p.du > uHi) uHi = p.u0 + p.du;
    }
    return [
      toPx(uLo, vLo),
      toPx(uHi, vLo),
      toPx(uHi, vHi),
      toPx(uLo, vHi),
    ]
      .map((pt) => pt.map((n) => n.toFixed(1)).join(","))
      .join(" ");
  }, [view, sim.outline_m, w_m, toPx, patches]);

  // The lengthwise edges an elevation of this element sees.
  //
  // A prismatic solid seen from the side shows one line per vertex of its section,
  // and orthographic convention says which way it is drawn: solid where the
  // silhouette itself steps, dashed where concrete nearer the viewer is in front of
  // it. Section views get none - there is nothing behind a cut.
  const elevation = useMemo(() => {
    if (view === "front" || view === "back") return [];
    if (view === "left") return elevationLines(sim.outline_m, 1, "min");
    if (view === "right") return elevationLines(sim.outline_m, 1, "max");
    return elevationLines(sim.outline_m, 0, view === "top" ? "max" : "min");
  }, [view, sim.outline_m]);

  /* ── viewport ─────────────────────────────────────────────────────────────── */

  const fitView = useCallback(() => setViewport({ zoom: 1, tx: 0, ty: 0 }), []);

  // client point -> sheet px. The viewBox is the container's own pixel box, so the
  // only thing between the two is the pan and the zoom.
  const toSheet = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return [
        (clientX - rect.left - viewport.tx) / viewport.zoom,
        (clientY - rect.top - viewport.ty) / viewport.zoom,
      ];
    },
    [viewport],
  );

  const zoomAbout = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setViewport((vp) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
        if (next === vp.zoom) return vp;
        const svg = svgRef.current;
        // No cursor: zoom about the middle of the sheet, which is what the +/- buttons
        // should do - anchoring those to a stale pointer position looks like a jump.
        let ax = svgW / 2;
        let ay = svgH / 2;
        if (svg && clientX !== undefined && clientY !== undefined) {
          const rect = svg.getBoundingClientRect();
          ax = clientX - rect.left;
          ay = clientY - rect.top;
        }
        const ratio = next / vp.zoom;
        return { zoom: next, tx: ax - (ax - vp.tx) * ratio, ty: ay - (ay - vp.ty) * ratio };
      });
    },
    [svgW, svgH],
  );

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    // no preventDefault: the listener React attaches is passive, so the page-level
    // `overflow: hidden` is what stops the wheel scrolling anything behind this.
    zoomAbout(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: viewport.tx, ty: viewport.ty, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    // Same 3px rule the number fields use: a press that never travels is a probe, a
    // press that travels is a pan. Without it, every attempt to probe nudges the sheet.
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!drag.moved) setPanning(true);
    drag.moved = true;
    setViewport((vp) => ({ ...vp, tx: drag.tx + dx, ty: drag.ty + dy }));
  };

  // where the popup can sit without leaving the canvas. Sized generously so the
  // expanded distances list does not push itself off the bottom edge.
  const anchorFor = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 16, y: 16 };
    const W = 264;
    const H = 300;
    return {
      x: Math.max(8, Math.min(clientX - rect.left + 16, rect.width - W - 8)),
      y: Math.max(8, Math.min(clientY - rect.top - 40, rect.height - H - 8)),
    };
  }, []);

  const sampleAtSheet = useCallback(
    (sx: number, sy: number, at: { x: number; y: number }) => {
      if (!fields || !frame) return;
      const u = (sx - originX) / scale;
      const v = vExt - (sy - originY) / scale;
      const section = projection.toSection(u, v);
      if (!section) {
        setProbe(null);
        return;
      }
      const s = sampleField(frame, fields.dx_m, section[0], section[1]);
      setProbe(s ? { sample: s, section_m: section, uv: [u, v], at } : null);
    },
    [fields, frame, scale, vExt, originX, originY, projection],
  );

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (drag?.moved) return;
    const sheet = toSheet(e.clientX, e.clientY);
    if (sheet) sampleAtSheet(sheet[0], sheet[1], anchorFor(e.clientX, e.clientY));
  };

  // jump the probe to the point the backend reported its own core temperature at.
  // Only meaningful in a section view - an elevation reads a face, and the backend's
  // point is inside the concrete.
  const probeAtBackendPoint = () => {
    if (!fields || !frame) return;
    const [x_m, y_m] = sim.probe_xy_m;
    const s = sampleField(frame, fields.dx_m, x_m, y_m);
    if (!s) return;
    setView("front");
    const rect = wrapRef.current?.getBoundingClientRect();
    setProbe({
      sample: s,
      section_m: [x_m, y_m],
      uv: [x_m, y_m],
      at: { x: 16, y: rect ? Math.max(8, rect.height - 320) : 16 },
    });
  };

  const geometry = useMemo(
    () => (probe ? probeGeometry(sim.outline_m, probe.section_m) : null),
    [probe, sim.outline_m],
  );

  const peakFrameIdx = fields
    ? fields.frame_indices.indexOf(sim.core_temp_c.indexOf(Math.max(...sim.core_temp_c)))
    : -1;
  const onPeakFrame = peakFrameIdx >= 0 && peakFrameIdx === frameIndex;
  const isSection = view === "front" || view === "back";
  const viewDef = VIEWS.find((v) => v.id === view)!;

  return (
    <div ref={wrapRef} className="relative flex min-h-0 flex-1 bg-bg-primary">
      {/* View switcher. Six presets, so this is a row of names rather than a segmented
          control - a segment per view would be six equal-weight tabs for what is really
          one primary view and five inspections of its faces. */}
      <Toolbar className="absolute left-1/2 top-4 z-20 -translate-x-1/2 flex-wrap justify-center">
        {VIEWS.map((v) => (
          <ToolbarButton
            key={v.id}
            active={view === v.id}
            onClick={() => setView(v.id)}
            title={v.hint}
          >
            {v.label}
          </ToolbarButton>
        ))}
        <ToolbarDivider />
        <span className="whitespace-nowrap px-1 font-mono text-[11px] tabular-nums text-text-secondary">
          {current_h.toFixed(1)} h
        </span>
        {onPeakFrame && <Flag tone="amber">peak core</Flag>}
      </Toolbar>

      {!fields && (
        <p className="pointer-events-none absolute left-1/2 top-24 z-10 max-w-md -translate-x-1/2 text-center text-xs leading-relaxed text-text-secondary">
          This response carries no per-cell temperature field, so there is nothing to
          shade. The outline below is the solved section; the colours are simply absent,
          not zero. Request the run with{" "}
          <code className="font-mono text-text-primary">fields=true</code>.
        </p>
      )}
      <div className="absolute inset-0">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          className={cx("h-full w-full touch-none", panning ? "cursor-grabbing" : "cursor-crosshair")}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          role="img"
          aria-label={`${viewDef.label} view — ${viewDef.hint}`}
        >
          <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.zoom})`}>
            <g style={{ opacity: opacity / 100 }}>
              {drawing?.entries.map(([band, d]) => (
                <path key={band} d={d} fill={drawing.bandColor(band)} shapeRendering="crispEdges" />
              ))}
            </g>

            <polygon
              points={silhouette}
              fill="none"
              stroke="var(--draft-line-strong)"
              strokeWidth={1.5 / viewport.zoom}
              strokeLinejoin="round"
            />

            {/* the element's own lengthwise edges, drawn the way a drawing office
                draws them: solid where the face steps, dashed where the concrete in
                front hides it. */}
            {showHidden &&
              elevation.map((line) => {
                const alongV = view === "left" || view === "right";
                const [x1, y1] = alongV ? toPx(0, line.at_m) : toPx(line.at_m, 0);
                const [x2, y2] = alongV ? toPx(uExt, line.at_m) : toPx(line.at_m, vExt);
                const w = (line.hidden ? 1.2 : 1.6) / viewport.zoom;
                const dash = line.hidden
                  ? `${7 / viewport.zoom} ${4 / viewport.zoom}`
                  : undefined;
                return (
                  <g key={line.at_m}>
                    {/* a dark underlay: these cross the middle of a bright field, where
                        a light hairline on its own disappears into the colour. */}
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="rgba(0,0,0,0.45)"
                      strokeWidth={w + 2 / viewport.zoom}
                      strokeDasharray={dash}
                    />
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={line.hidden ? "#c9ccd1" : "#eceef0"}
                      strokeOpacity={line.hidden ? 0.75 : 0.95}
                      strokeWidth={w}
                      strokeDasharray={dash}
                    />
                  </g>
                );
              })}

            {/* where the backend sampled its own core temperature. Section views only:
                in an elevation that point is buried inside the concrete, and drawing it
                on the face would claim it is somewhere it is not. */}
            {isSection &&
              (() => {
                const u = view === "front" ? sim.probe_xy_m[0] : w_m - sim.probe_xy_m[0];
                const [cx0, cy0] = toPx(u, sim.probe_xy_m[1]);
                const r = 4.5 / viewport.zoom;
                return (
                  <g>
                    <circle cx={cx0} cy={cy0} r={r} fill="none" stroke="#ffffff" strokeWidth={1.2 / viewport.zoom} />
                    <circle cx={cx0} cy={cy0} r={r / 3.5} fill="#ffffff" />
                  </g>
                );
              })()}

            {/* Which edge is which.
                A distance to "the nearest edge" is unreadable unless the edge is
                named on the drawing too, so every edge the readout can cite carries
                its letter out on the outside of the section, and the two the probe is
                measured to are drawn heavier. */}
            {showDistances && isSection && geometry && (
              <g>
                {geometry.edges.map((e, i) => {
                  const near = i < 2;
                  // a 128-sided circle would be a wall of letters; only the cited
                  // ones are named there.
                  if (!near && sim.outline_m.length > 12) return null;
                  const mirror = view === "back";
                  const ux = (x: number) => (mirror ? w_m - x : x);
                  const [x1, y1] = toPx(ux(e.from[0]), e.from[1]);
                  const [x2, y2] = toPx(ux(e.to[0]), e.to[1]);
                  const nx = mirror ? -e.normal[0] : e.normal[0];
                  return (
                    <g key={e.index} opacity={near ? 1 : 0.55}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="var(--accent-blue)"
                        strokeWidth={(near ? 2 : 1) / viewport.zoom}
                        strokeLinecap="round"
                      />
                      <text
                        x={(x1 + x2) / 2 + nx * 14}
                        y={(y1 + y2) / 2 - e.normal[1] * 14}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="11"
                        fontWeight={near ? 600 : 400}
                        fill="var(--accent-blue)"
                      >
                        {e.tag}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* the clicked point, with its distance lines to the two nearest faces */}
            {probe &&
              (() => {
                const [cx0, cy0] = toPx(probe.uv[0], probe.uv[1]);
                const r = 4 / viewport.zoom;
                return (
                  <g>
                    {showDistances && isSection && geometry && (
                      <g stroke="var(--accent-blue)" strokeWidth={0.8 / viewport.zoom} strokeDasharray={`${3 / viewport.zoom} ${3 / viewport.zoom}`}>
                        {geometry.edges.slice(0, 2).map((e) => {
                          const eu = view === "front" ? e.at[0] : w_m - e.at[0];
                          const [ex, ey] = toPx(eu, e.at[1]);
                          return <line key={e.index} x1={cx0} y1={cy0} x2={ex} y2={ey} />;
                        })}
                      </g>
                    )}
                    <circle cx={cx0} cy={cy0} r={r} fill="#7599fa" stroke="#0a0b0c" strokeWidth={1.5 / viewport.zoom} />
                  </g>
                );
              })()}

            {/* extension lines and overall dimensions, straight off the view extents */}
            <g stroke="var(--draft-line)" strokeWidth={0.75 / viewport.zoom}>
              <line x1={originX} y1={originY} x2={originX} y2={originY - 34} />
              <line x1={originX + sheetW} y1={originY} x2={originX + sheetW} y2={originY - 34} />
              <line x1={originX} y1={originY} x2={originX - 60} y2={originY} />
              <line x1={originX} y1={originY + sheetH} x2={originX - 60} y2={originY + sheetH} />
            </g>
            <Dim axis="h" from={originX} to={originX + sheetW} at={originY - 28} label={fmtLen(uExt, units)} />
            <Dim axis="v" from={originY} to={originY + sheetH} at={originX - 52} label={fmtLen(vExt, units)} />
          </g>
        </svg>
      </div>

      {/* Viewport controls, bottom strip. They used to sit on the left rail, which is
          where the input palette docks - chrome a palette covers by default is chrome
          nobody finds. Pan is a drag on the sheet itself, so the only buttons here are
          the ones a drag cannot express. */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
        <Toolbar>
          <ToolbarToggle icon={Minus} label="Zoom out" onClick={() => zoomAbout(0.8)} />
          <ToolbarToggle icon={Plus} label="Zoom in" onClick={() => zoomAbout(1.25)} />
          <ToolbarToggle icon={Maximize2} label="Fit the sheet" onClick={fitView} />
          <ToolbarDivider />
          {/* the label column shrinks to its own word here: the panel's 74px column
              exists to line a stack of rows up, and this row has no stack. */}
          <div className="px-1">
            <ScrubField
              label="Opacity"
              labelWidth="w-auto"
              unit="%"
              value={opacity}
              min={0}
              max={100}
              step={1}
              resetTo={100}
              onChange={setOpacity}
            />
          </div>
          <ToolbarDivider />
          <ToolbarButton
            icon={SquareDashed}
            active={showHidden && !isSection}
            disabled={isSection}
            onClick={() => setShowHidden((v) => !v)}
            title={
              isSection
                ? "Elevations only — a cut section has nothing behind it to hide"
                : "Lengthwise edges: solid where the face steps, dashed where concrete in front hides them"
            }
          >
            Hidden lines
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={Target} onClick={probeAtBackendPoint} title="Probe the point the backend reported its own core temperature at">
            Backend point
          </ToolbarButton>
        </Toolbar>
      </div>

      {/* Probe readout, anchored at the click. */}
      {probe && (
        <div
          className="pointer-events-auto absolute z-20 w-[264px]"
          style={{ left: `${probe.at.x}px`, top: `${probe.at.y}px` }}
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => setProbe(null)}
              aria-label="Dismiss probe"
              className="absolute -right-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-bg-surface text-text-muted ring-1 ring-inset ring-hairline hover:bg-elevate-2 hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <ProbeCard
              sample={probe.sample}
              geometry={isSection ? geometry : null}
              units={units}
              showDistances={showDistances}
              onToggleDistances={() => setShowDistances((s) => !s)}
              emptyHint=""
              footer={
                <>
                  backend probe_xy_m [{sim.probe_xy_m[0].toFixed(3)}, {sim.probe_xy_m[1].toFixed(3)}] m
                  <br />
                  peak_core_temp_c {sim.peak_core_temp_c.toFixed(2)} °C at {sim.peak_core_time_h.toFixed(1)} h
                </>
              }
            />
          </div>
        </div>
      )}

      {/* Sheet metadata and the interaction hint, stacked above the control strip.
          Both used to live in a corner, and both corners are where a palette docks —
          a title block behind a palette is a title block nobody reads. The centre
          column is the one strip of the viewer that nothing else claims. */}
      <div className="pointer-events-none absolute bottom-[68px] left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 text-center">
        {!probe && (
          <p className="whitespace-nowrap text-[11px] text-text-muted">
            {isSection
              ? "Click the section to sample a point · drag to pan · wheel to zoom"
              : "Click the face to read the outermost solved cell there · drag to pan · wheel to zoom"}
          </p>
        )}
        <p className="whitespace-nowrap font-mono text-[10px] tabular-nums text-text-muted/70">
          {fields
            ? `${fields.nx}×${fields.ny} @ ${(fields.dx_m * 1000).toFixed(0)} mm · bands ${BAND_STEP_C} °C`
            : "no per-cell field in this response"}
          {" · "}
          {isSection
            ? `any z, identical along ${fmtLen(length_m, units)} ${units}`
            : `face temperature, constant along ${fmtLen(length_m, units)} ${units}`}
          {" · "}
          {(viewport.zoom * 100).toFixed(0)} % zoom
        </p>
      </div>

      {/* temperature legend, floated over the sheet like every other instrument */}
      <div className="pointer-events-none absolute right-4 top-1/2 z-10 -translate-y-1/2">
        <ThermalLegend
          min_c={scaleBounds?.min_c}
          max_c={scaleBounds?.max_c}
          defLimit_c={sim.breaches.def_threshold_c}
          frameMin_c={range?.min_c}
          frameMax_c={range?.max_c}
        />
      </div>
    </div>
  );
}
