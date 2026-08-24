// Wilson score interval for a binomial proportion.
//
// Wald is the wrong tool here and not by a little. Every fraction the season artifact
// reports is 0 or 1 - DEF fires 0/30, cracking fires 30/30 - and at p = 0 or 1 the Wald
// half-width sqrt(p(1-p)/n) collapses to exactly zero. It would draw a point estimate
// with no width at all and assert certainty from thirty observations.
//
// Wilson does not collapse: it is built around a shrunk centre, so 0/30 comes back as
// roughly 0 to 11 percent, which is the honest statement.

// z for a two-sided 95% interval.
const Z95 = 1.959963984540054;

export interface Interval {
    lo: number;
    hi: number;
}

// k successes in n trials -> the 95% Wilson score interval, as fractions 0-1.
export function wilson(k: number, n: number, z: number = Z95): Interval | null {
    if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k < 0 || k > n) return null;
    const p = k / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / denom;
    const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

// the artifact reports percentages, not counts, and Wilson needs a count. Recover it,
// but only when it really is a whole number of days - a percentage that does not land on
// an integer means these are not n_days independent observations and no interval should
// be drawn from it.
export function countFromPct(pct: number, n: number): number | null {
    const k = (pct / 100) * n;
    const rounded = Math.round(k);
    return Math.abs(k - rounded) < 1e-6 ? rounded : null;
}
