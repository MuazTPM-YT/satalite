// preset cross-section outlines for the input panel's preview drawing.
//
// PREVIEW ONLY. These are not the solver's shapes: physics.geometry.SHAPES is
// slab / wall / rect_column / circular_column / beam / t_section / l_section, and the
// solved section the viewer draws always comes from the response's outline_m.
export type Outline = [number, number][];

// T outline in metres, flange on top
export function createTBeamOutline(
  flangeWidth_m = 0.6,
  flangeDepth_m = 0.15,
  webWidth_m = 0.25,
  totalDepth_m = 0.5,
): Outline {
  const a = (flangeWidth_m - webWidth_m) / 2.0;
  const b = (flangeWidth_m + webWidth_m) / 2.0;
  const y = totalDepth_m - flangeDepth_m;
  return [
    [a, 0.0],
    [b, 0.0],
    [b, y],
    [flangeWidth_m, y],
    [flangeWidth_m, totalDepth_m],
    [0.0, totalDepth_m],
    [0.0, y],
    [a, y],
  ];
}

// plain solid rectangle
export function createRectOutline(width_m = 0.6, depth_m = 0.5): Outline {
  return [
    [0.0, 0.0],
    [width_m, 0.0],
    [width_m, depth_m],
    [0.0, depth_m],
  ];
}

// clamp dimensions so degenerate inputs still make a valid solid
function clampDims(fw: number, fd: number, ww: number, td: number) {
  const tdSafe = Math.max(td, 0.05);
  const fwSafe = Math.max(Math.min(fw, 2.0), 0.05);
  const fdSafe = Math.max(Math.min(fd, tdSafe * 0.45), 0.01);
  const wwSafe = Math.max(Math.min(ww, fwSafe * 0.95), 0.01);
  return { fw: fwSafe, fd: fdSafe, ww: wwSafe, td: tdSafe };
}

// outline for a preset name; null = unknown
export function createOutlineForShape(
  shape: string,
  fw_m: number,
  fd_m: number,
  ww_m: number,
  td_m: number,
): Outline | null {
  const { fw, fd, ww, td } = clampDims(fw_m, fd_m, ww_m, td_m);
  if (shape === "T-Beam") return createTBeamOutline(fw, fd, ww, td);
  if (shape === "Rectangle") return createRectOutline(fw, td);
  return null;
}
