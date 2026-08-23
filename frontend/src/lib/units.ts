// length display units + metre conversions. canonical state stays SI everywhere

export type LengthUnit = "m" | "cm" | "mm" | "in" | "ft";

export const UNIT_OPTIONS: LengthUnit[] = ["m", "cm", "mm", "in", "ft"];

// metres per one display unit
const TO_M: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  ft: 0.3048,
};

// label decimals per unit
const DP: Record<LengthUnit, number> = { m: 3, cm: 1, mm: 0, in: 2, ft: 2 };

// metres -> display-unit number
export function mToUnit(m: number, u: LengthUnit): number {
  return m / TO_M[u];
}

// display-unit number -> metres
export function unitToM(v: number, u: LengthUnit): number {
  return v * TO_M[u];
}

// metres -> formatted label with unit-appropriate decimals
export function fmtLen(m: number, u: LengthUnit): string {
  return mToUnit(m, u).toFixed(DP[u]);
}

// round a display-unit number for input fields
export function roundDisp(v: number): number {
  return Math.round(v * 100) / 100;
}
