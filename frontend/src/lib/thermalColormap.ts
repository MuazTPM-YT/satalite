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
export function buildHeatmapTexture(
  tempSlice: number[][],
  mask: number[][],
  min_c: number,
  max_c: number
): THREE.DataTexture {
  const ny = tempSlice.length;
  const nx = tempSlice[0].length;
  const data = new Uint8Array(nx * ny * 4);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = (j * nx + i) * 4;
      if (mask[j][i] === 0) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }
      const [r, g, b] = tempToColor(tempSlice[j][i], min_c, max_c);
      data[idx] = Math.round(r * 255);
      data[idx + 1] = Math.round(g * 255);
      data[idx + 2] = Math.round(b * 255);
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
