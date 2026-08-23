// shared element + mix + pour config. one source of truth for LeftPanel inputs

export interface ElementConfig {
  shape: string;
  flange_width_mm: number;
  flange_depth_mm: number;
  web_width_mm: number;
  total_depth_mm: number;
  length_mm: number;
  formwork: string;
  top_face: string;
  soffit: string;
  grade: string;
  cement: string;
  content_kgm3: number;
  wcm: number;
  fly_ash_pct: number;
  placement_temp_c: number;
  pour_date: string;
  start_time: string;
  cure_window_h: number;
}

// defaults matching mock sim generator (createTBeamGrid + mock curves)
export const DEFAULT_ELEMENT_CONFIG: ElementConfig = {
  shape: "T-Beam",
  flange_width_mm: 600,
  flange_depth_mm: 150,
  web_width_mm: 250,
  total_depth_mm: 500,
  length_mm: 6000,
  formwork: "Plywood 18 mm",
  top_face: "Exposed",
  soffit: "Formed",
  grade: "4000 psi (28 MPa)",
  cement: "Type I/II",
  content_kgm3: 400,
  wcm: 0.45,
  fly_ash_pct: 20,
  placement_temp_c: 29,
  pour_date: "2026-08-22",
  start_time: "04:00",
  cure_window_h: 72,
};
