// self-check, no backend needed.
//   npx tsx src/lib/test_location.ts
//
// The two guards that stand between a judge and a broken demo: coverage, which decides
// whether a request may go out at all, and the date window, which decides whether the
// day exists at any price. Both mirror backend/app/services/location.py, and both run
// before anything is sent.
import { coverageBox, dateMode, lastAvailableDate, PRESETS, ARCHIVE_START } from "./location";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

/* ── coverage ───────────────────────────────────────────────────────────────── */

// every preset the picker offers has to be inside coverage. A preset that is not is a
// button that fails on click, which is worse than no button.
for (const p of PRESETS) {
  assert(coverageBox(p.lat, p.lon) !== null, `preset ${p.id} must be inside US coverage`);
}

// Alaska and Hawaii are not in the continental box and are not optional.
assert(coverageBox(61.22, -149.9)?.name === "Alaska", "Anchorage must resolve to Alaska");
assert(coverageBox(21.31, -157.86)?.name === "Hawaii", "Honolulu must resolve to Hawaii");

// THE failure this exists to prevent: a judge typing a city outside US coverage.
assert(coverageBox(25.2, 55.27) === null, "Dubai must be out of coverage");
assert(coverageBox(51.5, -0.13) === null, "London must be out of coverage");
assert(coverageBox(-33.87, 151.21) === null, "Sydney must be out of coverage");

// The Aleutians cross the antimeridian, so Alaska needs two boxes. One box spanning
// -179 to +172 would swallow the whole Pacific — this is that box not being written.
assert(coverageBox(52.0, 173.0) !== null, "the Aleutians east of the antimeridian are covered");
assert(coverageBox(21.31, 174.0) === null, "mid-Pacific at Hawaii's latitude is NOT covered");

/* ── the date window ────────────────────────────────────────────────────────── */

const now = new Date("2026-08-25T12:00:00Z");

assert(dateMode("2025-07-15", now) === "archive", "a past day inside the archive is archive");
assert(dateMode(ARCHIVE_START, now) === "archive", "the archive's first day is inside it");
assert(
  dateMode("2020-12-31", now).startsWith("2020-12-31 is before"),
  "the day before the archive names the range instead of guessing",
);
assert(
  dateMode("2030-01-01", now).includes("forecast horizon"),
  "a day past the horizon says so",
);
// the horizon is 12 hours from now, so at midday it reaches into tomorrow.
assert(dateMode(lastAvailableDate(now), now) === "forecast", "the last available day is forecast");
assert(
  dateMode("2026-08-25", now) === "archive",
  "today is archive, not forecast",
);
assert(dateMode("not-a-date", now).includes("YYYY-MM-DD"), "a malformed date is named as one");

console.log("LOCATION OK. coverage rejects non-US, the date window names its own edges.");
