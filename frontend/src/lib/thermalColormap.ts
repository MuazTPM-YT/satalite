// thermal colormap. maps celsius to RGB for heatmap rendering
import * as THREE from "three";

// Colormap: INFERNO, clipped to t >= 0.15.
//
// The previous ramp was a rainbow (blue -> cyan -> green -> yellow -> red). A
// rainbow is the wrong tool for a measured field: its lightness is not monotonic,
// so it invents bright bands at cyan and yellow that read as boundaries in the
// data where the data has none, and it collapses under most colour-vision
// deficiencies. Inferno is perceptually uniform and rises monotonically in
// lightness from cold to hot, so "brighter" always means "hotter" and nothing but
// the numbers creates a contour.
//
// The dark end is clipped at inferno(0.15) rather than 0.0 because the canvas is
// itself near-black - an unclipped ramp would let the coldest concrete disappear
// into the background instead of reading as the coolest part of a solid.
const STOPS: [number, number, number, number][] = [
  [0.0, 0.157, 0.043, 0.302],
  [0.125, 0.263, 0.039, 0.396],
  [0.25, 0.38, 0.082, 0.433],
  [0.375, 0.498, 0.118, 0.431],
  [0.5, 0.62, 0.153, 0.403],
  [0.625, 0.741, 0.204, 0.347],
  [0.75, 0.851, 0.29, 0.255],
  [0.812, 0.901, 0.359, 0.196],
  [0.875, 0.945, 0.451, 0.11],
  [0.937, 0.976, 0.588, 0.055],
  [0.97, 0.988, 0.702, 0.106],
  [1.0, 0.988, 0.867, 0.353],
];

// interpolate between colormap stops
export function tempToColor(
  temp_c: number,
  min_c: number,
  max_c: number
): [number, number, number] {
  const range = max_c - min_c;
  const t = range > 0 ? Math.max(0, Math.min(1, (temp_c - min_c) / range)) : 0;

  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, r0, g0, b0] = STOPS[i - 1];
      const [t1, r1, g1, b1] = STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return [r0 + f * (r1 - r0), g0 + f * (g1 - g0), b0 + f * (b1 - b0)];
    }
  }
  const last = STOPS[STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

// build RGBA DataTexture from one field frame for the cross-section heatmap.
// null cells hold no concrete; they take the nearest concrete colour so LinearFilter
// cannot bleed a hole's colour into the solid, and they are drawn fully transparent.
export function buildHeatmapTexture(
  frame: (number | null)[][],
  min_c: number,
  max_c: number
): THREE.DataTexture {
  const ny = frame.length;
  const nx = ny > 0 ? frame[0].length : 0;
  const data = new Uint8Array(nx * ny * 4);

  // first pass: colour the concrete
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = frame[j][i];
      if (v === null) continue;
      const idx = (j * nx + i) * 4;
      const [r, g, b] = tempToColor(v, min_c, max_c);
      data[idx] = Math.round(r * 255);
      data[idx + 1] = Math.round(g * 255);
      data[idx + 2] = Math.round(b * 255);
      data[idx + 3] = 255;
    }
  }

  // second pass: holes borrow the nearest concrete colour, at zero alpha
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (frame[j][i] !== null) continue;
      let best_d2 = Infinity;
      let br = 0, bg = 0, bb = 0;
      const search = Math.min(8, Math.max(nx, ny));
      for (let dj = -search; dj <= search; dj++) {
        for (let di = -search; di <= search; di++) {
          const nj = j + dj;
          const ni = i + di;
          if (nj < 0 || nj >= ny || ni < 0 || ni >= nx) continue;
          if (frame[nj][ni] === null) continue;
          const d2 = di * di + dj * dj;
          if (d2 < best_d2) {
            best_d2 = d2;
            const src = (nj * nx + ni) * 4;
            br = data[src];
            bg = data[src + 1];
            bb = data[src + 2];
          }
        }
      }
      const idx = (j * nx + i) * 4;
      data[idx] = br;
      data[idx + 1] = bg;
      data[idx + 2] = bb;
      data[idx + 3] = 0;
    }
  }

  const tex = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// build CSS gradient string from same stops so legend matches texture exactly
export function buildLegendGradient(): string {
  const cssStops = [...STOPS]
    .reverse()
    .map(([t, r, g, b]) => {
      const hex = (v: number) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, "0");
      return `#${hex(r)}${hex(g)}${hex(b)} ${((1 - t) * 100).toFixed(0)}%`;
    })
    .join(", ");
  return `linear-gradient(to bottom, ${cssStops})`;
}

