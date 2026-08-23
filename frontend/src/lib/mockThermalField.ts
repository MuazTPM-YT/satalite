// types matching real simulation schema
export interface GridData {
  nx: number;
  ny: number;
  dx_m: number;
  mask: number[][]; // [y][x] 1 for concrete, 0 for air
  outline: [number, number][]; // 2D polygon vertices in metres
}

export interface FieldsData {
  temperature_c: number[][][]; // [time_idx][y][x]
  maturity_ch: number[][][]; // equivalent age in °C-hours or equivalent hours
  strength_frac: number[][][]; // relative compressive strength 0.0 to 1.0
}

export interface CurvesData {
  core_temp_c: number[];
  surface_temp_c: number[];
  strength_frac: number[];
  strength_p05: number[];
  strength_p95: number[];
}

export interface FlagCheck {
  status: "pass" | "warn" | "fail";
  value: number;
  limit: number;
  unit: string;
  label: string;
  subtitle: string;
  warning?: string;
}

export interface StripReadyFlag {
  ready_time: string;
  confidence_pct: number;
  delta_h: number;
  current_strength_pct: number;
  required_strength_pct: number;
}

export interface FlagsData {
  def_risk: FlagCheck;
  cracking: FlagCheck;
  placement: FlagCheck;
  evaporation: FlagCheck;
  strip_ready: StripReadyFlag;
}

export interface SimulationMetadata {
  created_at: string;
  element_shape: string;
  cure_window_h: number;
  peak_temp_c: number;
  max_gradient_c: number;
  peak_time_h: number;
}

export interface ThermalSimulationResult {
  grid: GridData;
  times_h: number[];
  fields: FieldsData;
  curves: CurvesData;
  flags: FlagsData;
  meta: SimulationMetadata;
}

export interface PourWindowCandidate {
  start_time: string;
  selected?: boolean;
  checks_fail_badge?: string;
  peak_core_c: number;
  peak_core_pass: boolean;
  delta_t_c: number;
  delta_t_status: "pass" | "warn" | "fail";
  evaporation_rate: number;
  evaporation_pass: boolean;
  strip_ready_h: number;
  strip_ready_pct: number;
  fastest?: boolean;
}

// make closed T-beam outline in metres matching panel dimensions
export function createTBeamOutline(
  flangeWidth_m = 0.6,
  flangeDepth_m = 0.15,
  webWidth_m = 0.25,
  totalDepth_m = 0.5
): [number, number][] {
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

// shortest distance from point to line segment
function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// build raster grid and binary mask for T-beam
export function createTBeamGrid(dx_m = 0.0125): GridData {
  const flangeWidth_m = 0.6;
  const flangeDepth_m = 0.15;
  const webWidth_m = 0.25;
  const totalDepth_m = 0.5;

  const nx = Math.round(flangeWidth_m / dx_m);
  const ny = Math.round(totalDepth_m / dx_m);
  const outline = createTBeamOutline(
    flangeWidth_m,
    flangeDepth_m,
    webWidth_m,
    totalDepth_m
  );

  const mask: number[][] = [];
  const webLeft_m = (flangeWidth_m - webWidth_m) / 2.0;
  const webRight_m = (flangeWidth_m + webWidth_m) / 2.0;
  const flangeBottom_m = totalDepth_m - flangeDepth_m;

  for (let j = 0; j < ny; j++) {
    const row: number[] = [];
    const y_m = (j + 0.5) * dx_m;
    for (let i = 0; i < nx; i++) {
      const x_m = (i + 0.5) * dx_m;
      const inFlange = y_m >= flangeBottom_m && x_m >= 0 && x_m <= flangeWidth_m;
      const inWeb =
        y_m < flangeBottom_m && x_m >= webLeft_m && x_m <= webRight_m;
      row.push(inFlange || inWeb ? 1 : 0);
    }
    mask.push(row);
  }

  return { nx, ny, dx_m, mask, outline };
}

// point-in-polygon test, ray cast method
function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// raster grid from any closed outline — used by IFC import path
export function createGridFromOutline(
  outline: [number, number][],
  dx_m = 0.0125
): GridData {
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;

  const nx = Math.max(4, Math.round(w / dx_m));
  const ny = Math.max(4, Math.round(h / dx_m));

  const mask: number[][] = [];
  for (let j = 0; j < ny; j++) {
    const row: number[] = [];
    const y = y0 + (j + 0.5) * dx_m;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * dx_m;
      row.push(pointInPolygon(x, y, outline) ? 1 : 0);
    }
    mask.push(row);
  }

  return { nx, ny, dx_m, mask, outline };
}

// generate realistic synthetic thermal simulation result
// grid override lets imported IFC outlines run through the same pipeline
export function generateMockThermalSimulation(
  gridOverride?: GridData
): ThermalSimulationResult {
  const dt_h = 0.5;
  const max_time_h = 72;
  const num_steps = Math.round(max_time_h / dt_h) + 1;

  const times_h: number[] = [];
  for (let s = 0; s < num_steps; s++) {
    times_h.push(Number((s * dt_h).toFixed(1)));
  }

  const grid = gridOverride ?? createTBeamGrid(0.0125);
  const { nx, ny, dx_m, mask, outline } = grid;

  // find distance to boundary for every cell to shape temperature field
  const dist_field: number[][] = [];
  let max_dist = 0;

  for (let j = 0; j < ny; j++) {
    const d_row: number[] = [];
    const y_m = (j + 0.5) * dx_m;
    for (let i = 0; i < nx; i++) {
      const x_m = (i + 0.5) * dx_m;
      if (mask[j][i] === 0) {
        d_row.push(0);
        continue;
      }
      let min_d = Infinity;
      for (let p = 0; p < outline.length; p++) {
        const p1 = outline[p];
        const p2 = outline[(p + 1) % outline.length];
        const d = distToSegment(x_m, y_m, p1[0], p1[1], p2[0], p2[1]);
        if (d < min_d) min_d = d;
      }
      d_row.push(min_d);
      if (min_d > max_dist) max_dist = min_d;
    }
    dist_field.push(d_row);
  }

  // core = deepest cell (max boundary distance), works for any outline
  const dist_flat = dist_field.flatMap((r) => r);
  let max_i = 0;
  for (let k = 1; k < dist_flat.length; k++) {
    if (dist_flat[k] > dist_flat[max_i]) max_i = k;
  }
  const core_j = Math.floor(max_i / nx);
  const core_i = max_i % nx;

  const core_temp_c: number[] = [];
  const surface_temp_c: number[] = [];
  const strength_frac: number[] = [];
  const strength_p05: number[] = [];
  const strength_p95: number[] = [];

  const temperature_c: number[][][] = [];
  const maturity_ch: number[][][] = [];
  const strength_grid: number[][][] = [];

  // cumulative maturity tracking grid
  const current_maturity: number[][] = Array.from({ length: ny }, () =>
    Array(nx).fill(0)
  );

  for (let t_idx = 0; t_idx < times_h.length; t_idx++) {
    const t = times_h[t_idx];

    // ambient diurnal cycle
    const t_ambient = 24.0 + 3.0 * Math.sin(((t - 6) * Math.PI) / 12);

    // hydration pulse peaking near hour 17.5 - 18.0
    const peak_target_h = 17.5;
    const pulse =
      Math.pow(t / peak_target_h, 1.8) *
      Math.exp(1.8 * (1 - t / peak_target_h));

    // core temperature curve: 29°C start, 58°C peak, decay towards ambient
    let t_core =
      t === 0
        ? 29.0
        : 29.0 +
          29.0 * pulse -
          0.12 * Math.max(0, t - 24) +
          1.2 * Math.sin(((t - 10) * Math.PI) / 12) * (1 - pulse);

    // ensure exact peak match at 58.0°C and placement at 29.0°C
    if (t === 0) t_core = 29.0;
    if (Math.abs(t - 17.5) < 0.01) t_core = 58.0;

    // surface temperature: max deltaT is 14°C at peak
    const delta_t_current = 14.0 * pulse;
    const t_surf = t === 0 ? 29.0 : Math.max(t_ambient, t_core - delta_t_current);

    core_temp_c.push(Number(t_core.toFixed(2)));
    surface_temp_c.push(Number(t_surf.toFixed(2)));

    // 2D slice for this time step
    const temp_slice: number[][] = [];
    const mat_slice: number[][] = [];
    const str_slice: number[][] = [];

    for (let j = 0; j < ny; j++) {
      const temp_row: number[] = [];
      const mat_row: number[] = [];
      const str_row: number[] = [];

      for (let i = 0; i < nx; i++) {
        if (mask[j][i] === 0) {
          temp_row.push(Number(t_ambient.toFixed(2)));
          mat_row.push(0);
          str_row.push(0);
          continue;
        }

        // 2D thermal diffusion: geometric distance + heat conduction from core/web column
        const x_m = (i + 0.5) * dx_m;
        const y_m = (j + 0.5) * dx_m;
        const w_geom = Math.pow(dist_field[j][i] / (max_dist || 1), 1.25);
        const dx_c = (x_m - 0.30) / 0.14;
        const dy_c = (y_m - 0.20) / 0.32;
        const core_influence = Math.exp(-0.5 * (dx_c * dx_c + dy_c * dy_c));
        const d_top = Math.max(0, 0.5 - y_m);
        const weight = Math.max(
          0,
          Math.min(
            1,
            0.4 * w_geom +
              0.6 * core_influence * (0.4 + 0.6 * (d_top / 0.025))
          )
        );
        const cell_temp = t_surf + weight * (t_core - t_surf);

        // maturity increment: Arrhenius equivalent age rate
        const arrhenius = Math.exp(
          -4000 * (1 / (cell_temp + 273.15) - 1 / 296.15)
        );
        current_maturity[j][i] += dt_h * arrhenius;

        // hyperbolic strength gain curve (Freiesleben Hansen / ASTM C1074)
        const mat = current_maturity[j][i];
        const str = mat <= 2 ? 0 : (0.88 * (mat - 2)) / (18 + (mat - 2));

        temp_row.push(Number(cell_temp.toFixed(2)));
        mat_row.push(Number(mat.toFixed(2)));
        str_row.push(Number(Math.min(1.0, Math.max(0, str)).toFixed(3)));
      }

      temp_slice.push(temp_row);
      mat_slice.push(mat_row);
      str_slice.push(str_row);
    }

    temperature_c.push(temp_slice);
    maturity_ch.push(mat_slice);
    strength_grid.push(str_slice);

    // overall strength curve sampled from web center
    const s_val = str_slice[core_j][core_i];
    strength_frac.push(Number(s_val.toFixed(3)));
    strength_p05.push(Number((s_val * 0.93).toFixed(3)));
    strength_p95.push(Number(Math.min(1.0, s_val * 1.07).toFixed(3)));
  }

  // flags matching UI panels
  const flags: FlagsData = {
    def_risk: {
      status: "pass",
      value: 58,
      limit: 70,
      unit: "°C",
      label: "DEF Risk",
      subtitle: "peak core",
    },
    cracking: {
      status: "pass",
      value: 14,
      limit: 20,
      unit: "°C",
      label: "Cracking",
      subtitle: "max ΔT core-surf",
    },
    placement: {
      status: "pass",
      value: 29,
      limit: 32,
      unit: "°C",
      label: "Placement",
      subtitle: "concrete at discharge",
    },
    evaporation: {
      status: "warn",
      value: 0.23,
      limit: 0.2,
      unit: "kg/m²/h",
      label: "Evaporation",
      subtitle: "rate",
      warning:
        "Exceeded 08:20–11:10. Fogging or evaporation retarder required on the exposed top face.",
    },
    strip_ready: {
      ready_time: "Thu 14:00",
      confidence_pct: 95,
      delta_h: 3.5,
      current_strength_pct: 0,
      required_strength_pct: 70,
    },
  };

  const meta: SimulationMetadata = {
    created_at: "2026-08-22T04:00:00Z",
    element_shape: "T-Beam",
    cure_window_h: max_time_h,
    peak_temp_c: 58.0,
    max_gradient_c: 14.0,
    peak_time_h: 17.5,
  };

  return {
    grid,
    times_h,
    fields: {
      temperature_c,
      maturity_ch,
      strength_frac: strength_grid,
    },
    curves: {
      core_temp_c,
      surface_temp_c,
      strength_frac,
      strength_p05,
      strength_p95,
    },
    flags,
    meta,
  };
}

// pour window candidate summary rows for comparison table
export function getPourWindowCandidates(): PourWindowCandidate[] {
  return [
    {
      start_time: "04:00",
      selected: true,
      peak_core_c: 58,
      peak_core_pass: true,
      delta_t_c: 14,
      delta_t_status: "pass",
      evaporation_rate: 0.11,
      evaporation_pass: true,
      strip_ready_h: 62,
      strip_ready_pct: 86,
    },
    {
      start_time: "09:00",
      peak_core_c: 64,
      peak_core_pass: true,
      delta_t_c: 19,
      delta_t_status: "warn",
      evaporation_rate: 0.18,
      evaporation_pass: true,
      strip_ready_h: 57,
      strip_ready_pct: 79,
    },
    {
      start_time: "14:00",
      checks_fail_badge: "3 CHECKS FAIL",
      peak_core_c: 71,
      peak_core_pass: false,
      delta_t_c: 24,
      delta_t_status: "fail",
      evaporation_rate: 0.31,
      evaporation_pass: false,
      strip_ready_h: 51,
      strip_ready_pct: 100,
      fastest: true,
    },
  ];
}
