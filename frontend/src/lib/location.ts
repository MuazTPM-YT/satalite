// Where the pour is. US-only, because that is where the temperature API answers.
//
// Every bound and every preset here mirrors backend/app/services/location.py. The
// backend validates again - it has to, it is the trust boundary - but a judge typing
// Dubai must be told before a request goes out, not after one comes back.

export interface UsBox {
    name: string;
    lat: [number, number];
    lon: [number, number];
}

// The Aleutians cross the antimeridian, so Alaska needs two boxes. One box spanning
// -179 to +172 would also contain the entire Pacific.
export const US_BOXES: readonly UsBox[] = [
    { name: "continental US", lat: [24.396308, 49.384358], lon: [-125.0, -66.93457] },
    { name: "Alaska", lat: [51.0, 71.5], lon: [-179.15, -129.0] },
    { name: "Alaska (Aleutians)", lat: [51.0, 53.5], lon: [172.0, 180.0] },
    { name: "Hawaii", lat: [18.86, 22.24], lon: [-160.25, -154.75] },
];

/** which coverage box holds this point, or null when the API does not answer for it. */
export function coverageBox(lat: number, lon: number): UsBox | null {
    return (
        US_BOXES.find(
            (b) => lat >= b.lat[0] && lat <= b.lat[1] && lon >= b.lon[0] && lon <= b.lon[1],
        ) ?? null
    );
}

export interface Preset {
    id: string;
    label: string;
    lat: number;
    lon: number;
}

// Phoenix first and deliberately: it is the only site with cached days, so it is the
// only one that costs nothing. The others span latitude, which is the parameter that
// changes the answer - declination, sunset hour angle and daylength all move with it.
export const PRESETS: readonly Preset[] = [
    { id: "phoenix", label: "Phoenix, AZ", lat: 33.45, lon: -112.07 },
    { id: "miami", label: "Miami, FL", lat: 25.76, lon: -80.19 },
    { id: "houston", label: "Houston, TX", lat: 29.76, lon: -95.37 },
    { id: "los_angeles", label: "Los Angeles, CA", lat: 34.05, lon: -118.24 },
    { id: "denver", label: "Denver, CO", lat: 39.74, lon: -104.99 },
    { id: "chicago", label: "Chicago, IL", lat: 41.88, lon: -87.63 },
    { id: "seattle", label: "Seattle, WA", lat: 47.61, lon: -122.33 },
    { id: "anchorage", label: "Anchorage, AK", lat: 61.22, lon: -149.9 },
    { id: "honolulu", label: "Honolulu, HI", lat: 21.31, lon: -157.86 },
];

/** the day the demo band and the season cache were built for. Cached, costs nothing. */
export const DEMO_DATE = "2025-07-15";

/** FortyGuard's archive floor. Anything earlier has no data at any price. */
export const ARCHIVE_START = "2021-01-01";

/** how far past now the forecast reaches. */
export const FORECAST_HORIZON_H = 12;

/** a day costs this many credits to fetch, flat, whatever the area. */
export const CREDITS_PER_DAY = 4220;

/** the last day the API can answer for: today plus the forecast horizon. */
export function lastAvailableDate(now: Date = new Date()): string {
    const horizon = new Date(now.getTime() + FORECAST_HORIZON_H * 3600_000);
    return horizon.toISOString().slice(0, 10);
}

/** archive, forecast, or a sentence saying why neither. */
export function dateMode(day: string, now: Date = new Date()): "archive" | "forecast" | string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Enter a date as YYYY-MM-DD.";
    if (day < ARCHIVE_START) {
        return `${day} is before the archive starts. Coverage runs ${ARCHIVE_START} to ${lastAvailableDate(now)}.`;
    }
    if (day > lastAvailableDate(now)) {
        return `${day} is past the ${FORECAST_HORIZON_H} hour forecast horizon. ${lastAvailableDate(now)} is the last day available.`;
    }
    return day <= now.toISOString().slice(0, 10) ? "archive" : "forecast";
}
