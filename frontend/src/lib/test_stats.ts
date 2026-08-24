// self-check for the Wilson interval. Run: npx tsx src/lib/test_stats.ts
import { wilson, countFromPct } from "./stats";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const near = (a: number, b: number, tol = 5e-4) => Math.abs(a - b) < tol;

// THE case this exists for: 0 of 30. Wald would give zero width and claim certainty.
let i = wilson(0, 30)!;
assert(near(i.lo, 0), `0/30 lower bound should be 0, got ${i.lo}`);
assert(near(i.hi, 0.1135), `0/30 upper bound should be about 0.1135, got ${i.hi}`);
assert(i.hi - i.lo > 0.1, "0/30 must have real width; a zero-width interval is the bug");

// and its mirror
i = wilson(30, 30)!;
assert(near(i.hi, 1), `30/30 upper bound should be 1, got ${i.hi}`);
assert(near(i.lo, 0.8865), `30/30 lower bound should be about 0.8865, got ${i.lo}`);

// symmetric about a half
i = wilson(15, 30)!;
assert(near(i.lo + i.hi, 1), `15/30 should straddle 0.5 symmetrically, got ${i.lo}..${i.hi}`);
assert(i.lo < 0.5 && i.hi > 0.5, "15/30 must contain 0.5");

// 18/30 is the placement figure at 04:00
i = wilson(18, 30)!;
assert(i.lo < 0.6 && i.hi > 0.6, `18/30 must contain 0.6, got ${i.lo}..${i.hi}`);

// more observations, tighter interval
const w30 = wilson(0, 30)!;
const w300 = wilson(0, 300)!;
assert(w300.hi < w30.hi, "300 observations must bound tighter than 30");

// bad input is null, never a made-up interval
assert(wilson(31, 30) === null, "k > n must be null");
assert(wilson(0, 0) === null, "n = 0 must be null");

// percentage -> count, only when it is really a whole number of days
assert(countFromPct(60, 30) === 18, "60% of 30 days is 18");
assert(countFromPct(100, 30) === 30, "100% of 30 days is 30");
assert(countFromPct(0, 30) === 0, "0% of 30 days is 0");
assert(countFromPct(33.3, 30) === null, "a non-integral count must refuse rather than round");

console.log("STATS OK. Wilson holds at 0/30 and 30/30 where Wald collapses.");
