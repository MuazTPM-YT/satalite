// thermal colormap. maps celsius to RGB for heatmap rendering
import * as THREE from "three";

// colormap stops: deep blue (cold) → cyan → green → yellow → red (hot)
const STOPS: [number, number, number, number][] = [
  [0.0, 0.11, 0.25, 0.65],
  [0.25, 0.15, 0.55, 0.85],
  [0.4, 0.13, 0.75, 0.55],
  [0.55, 0.45, 0.85, 0.15],
  [0.7, 0.85, 0.85, 0.1],
  [0.85, 0.95, 0.55, 0.1],
  [1.0, 0.85, 0.15, 0.1],
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

// build RGBA DataTexture from temperature slice for cross-section heatmap
// air cells get nearest-concrete-cell color to prevent LinearFilter bleed
export function buildHeatmapTexture(
  tempSlice: number[][],
  mask: number[][],
  min_c: number,
  max_c: number
): THREE.DataTexture {
  const ny = tempSlice.length;
  const nx = tempSlice[0].length;
  const data = new Uint8Array(nx * ny * 4);

  // first pass: color concrete cells
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = (j * nx + i) * 4;
      if (mask[j][i] === 0) continue;
      const [r, g, b] = tempToColor(tempSlice[j][i], min_c, max_c);
      data[idx] = Math.round(r * 255);
      data[idx + 1] = Math.round(g * 255);
      data[idx + 2] = Math.round(b * 255);
      data[idx + 3] = 255;
    }
  }

  // second pass: fill air cells with nearest concrete neighbor color
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (mask[j][i] === 1) continue;
      let best_d2 = Infinity;
      let br = 0, bg = 0, bb = 0;
      const search = Math.min(8, Math.max(nx, ny));
      for (let dj = -search; dj <= search; dj++) {
        for (let di = -search; di <= search; di++) {
          const nj = j + dj;
          const ni = i + di;
          if (nj < 0 || nj >= ny || ni < 0 || ni >= nx) continue;
          if (mask[nj][ni] === 0) continue;
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
      data[idx + 3] = best_d2 < Infinity ? 255 : 0;
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

