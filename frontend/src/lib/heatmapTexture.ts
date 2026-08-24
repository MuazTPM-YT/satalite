// The solved field as a texture for the 3D mesh.
//
// Split out of lib/thermalColormap.ts because it is the only part of the colour ramp
// that needs three.js, and the 2D sheet needs the rest of it. Keeping them together
// meant the WebGL renderer shipped in the first bundle whether or not the 3D viewer
// was ever opened.
import * as THREE from "three";
import { tempToColor } from "@/lib/thermalColormap";

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
