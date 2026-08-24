// sample the solved temperature field at a physical point.
//
// This is a line-for-line mirror of Section.probe_stencil in backend/physics/geometry.py,
// including its nearest-solid fallback and its tie-breaking. It has to be: the backend
// reports peak_core_temp_c by sampling probe_xy_m this exact way, so any other scheme
// here would put two different numbers on screen for the same point and neither would
// be wrong enough to look wrong.
//
// Grid convention, also from geometry.py: row 0 is the base, y increases upward, and
// cell (j, i) has its centre at ((i + 0.5) * dx_m, (j + 0.5) * dx_m).

// a field frame as the api sends it: [y][x] celsius, null outside the mask.
export type Frame = (number | null)[][];

export interface Sample {
    temp_c: number;
    // where the stencil actually read, metres. Exact for bilinear, honest for the
    // fallback - it must not claim a point that was not sampled.
    xy_m: [number, number];
    // true when the 2x2 straddled a hole or the outside and one solid cell was used.
    fallback: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(Math.max(v, lo), hi);
}

// bilinear at a coordinate, falling back to the nearest solid cell. null when the
// section holds no concrete at all, which cannot happen on a solved frame.
export function sampleField(
    frame: Frame,
    dx_m: number,
    x_m: number,
    y_m: number,
): Sample | null {
    const ny = frame.length;
    const nx = ny > 0 ? frame[0].length : 0;
    if (nx === 0 || ny === 0) return null;

    const fx = clamp(x_m / dx_m - 0.5, 0.0, nx - 1.0);
    const fy = clamp(y_m / dx_m - 0.5, 0.0, ny - 1.0);
    const j0 = Math.floor(fx);
    const i0 = Math.floor(fy);
    const j1 = Math.min(j0 + 1, nx - 1);
    const i1 = Math.min(i0 + 1, ny - 1);
    const tx = fx - j0;
    const ty = fy - i0;

    const rows = [i0, i0, i1, i1];
    const cols = [j0, j1, j0, j1];
    const weights = [
        (1 - tx) * (1 - ty),
        tx * (1 - ty),
        (1 - tx) * ty,
        tx * ty,
    ];

    const values = rows.map((r, k) => frame[r][cols[k]]);
    if (values.every((v) => v !== null)) {
        let temp = 0;
        let sx = 0;
        let sy = 0;
        for (let k = 0; k < 4; k++) {
            temp += (values[k] as number) * weights[k];
            sx += (cols[k] + 0.5) * weights[k];
            sy += (rows[k] + 0.5) * weights[k];
        }
        return { temp_c: temp, xy_m: [sx * dx_m, sy * dx_m], fallback: false };
    }

    // nearest solid cell. Scanned row-major with a strict <, which is how numpy's
    // nonzero + argmin break a tie on the backend - a different tie rule would pick a
    // different cell on a symmetric section.
    let bestR = -1;
    let bestC = -1;
    let bestD2 = Infinity;
    for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
            if (frame[r][c] === null) continue;
            const d2 = (c - fx) ** 2 + (r - fy) ** 2;
            if (d2 < bestD2) {
                bestD2 = d2;
                bestR = r;
                bestC = c;
            }
        }
    }
    if (bestR < 0) return null;
    return {
        temp_c: frame[bestR][bestC] as number,
        xy_m: [(bestC + 0.5) * dx_m, (bestR + 0.5) * dx_m],
        fallback: true,
    };
}

// min and max over the concrete in one frame. Nulls are holes, not cold spots.
export function frameRange(frame: Frame): { min_c: number; max_c: number } | null {
    let min_c = Infinity;
    let max_c = -Infinity;
    for (const row of frame) {
        for (const v of row) {
            if (v === null) continue;
            if (v < min_c) min_c = v;
            if (v > max_c) max_c = v;
        }
    }
    return min_c === Infinity ? null : { min_c, max_c };
}
