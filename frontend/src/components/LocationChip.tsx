// Where the pour is, in the command bar.
//
// This used to be a hardcoded caption. Latitude is a real parameter - it sets solar
// declination, sunset hour angle and daylength, so it moves the solar term and with it
// the whole 4am-against-2pm comparison - and until now no control reached it.
//
// TWO THINGS THIS CONTROL EXISTS TO PREVENT.
//
// A judge typing Dubai and getting a stack trace. The temperature API answers for the
// United States only, so coordinates are checked against the coverage boxes in
// lib/location.ts BEFORE any request goes out. The backend checks again, because that
// is the trust boundary, but the user finds out while typing.
//
// A live fetch per selection. A day that is not already cached costs 4220 credits
// against a few hundred calls of remaining headroom. So every selection is priced by
// /api/ambient/quote, which never calls FortyGuard, and spending needs a second,
// explicit click on a button that says the number.
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MapPin } from "lucide-react";
import {
    ambientQuote,
    buildAmbient,
    ApiError,
    type AmbientQuote,
    type AmbientResponse,
} from "@/lib/api";
import {
    CREDITS_PER_DAY,
    PRESETS,
    coverageBox,
    dateMode,
    lastAvailableDate,
    ARCHIVE_START,
    type Preset,
} from "@/lib/location";
import { Segmented, cx } from "@/components/ui";
import { Select } from "@/components/fields";
import { useTooltip } from "@/components/Tooltip";

/** what the studio is currently solving against. */
export interface ActiveLocation {
    label: string;
    lat: number;
    lon: number;
    date: string;
    placementHour: number;
    // "stated" is the artifact's own day: three numbers written down, not observed.
    source: "cached" | "live" | "stated";
    mode: "archive" | "forecast";
    /**
     * Which measured triple the solve on screen is running against.
     *
     * "tile" means one 100 m tile picked on the map; "aoi_mean" means the average of
     * every tile in the AOI. They are different answers to the same day - over the demo
     * AOI the daily minimum spreads 0.37 °C between tiles - so the chip names which one
     * rather than leaving a reader to assume.
     */
    reduction?: "aoi_mean" | "tile";
    tileId?: string | null;
}

type Mode = "preset" | "coords";

interface Props {
    active: ActiveLocation | null;
    durationHours: number;
    /** hand the studio a new ambient plus the location it was built for. */
    onApply: (response: AmbientResponse, label: string) => void;
}

export default function LocationChip({ active, durationHours, onApply }: Props) {
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const measure = useCallback(() => {
        const el = triggerRef.current;
        if (el) setRect(el.getBoundingClientRect());
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        measure();
        const close = () => setOpen(false);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        return () => {
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", close, true);
        };
    }, [open, measure]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    // The dot carries the state the way HealthProbe's does: green is cached and free,
    // amber is live and costs credits, grey is nothing chosen yet.
    const dot =
        active === null || active.source === "stated"
            ? "bg-text-muted"
            : active.source === "cached"
              ? "bg-status-green"
              : "bg-status-amber";
    const tip = useTooltip(
        active === null ? (
            "Choose where the pour is."
        ) : (
            <>
                <span className="block font-medium">{active.label}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-text-secondary">
                    {active.lat.toFixed(4)}, {active.lon.toFixed(4)}
                    <br />
                    {active.date} {String(active.placementHour).padStart(2, "0")}:00 ·{" "}
                    {active.mode} · {active.source}
                    {active.source === "live" ? ` · ${CREDITS_PER_DAY} credits spent` : " · 0 credits"}
                </span>
                <span className="mt-1 block text-text-secondary">
                    Latitude drives solar declination, sunset hour angle and daylength.
                    {active.source === "stated" &&
                        " This day's min/mean/max were written down, not observed."}
                </span>
                <span className="mt-1 block text-text-secondary">
                    {active.reduction === "tile"
                        ? `Solved against tile ${active.tileId} alone — the 100 m cell this point sits in.`
                        : "Solved against the AOI mean — every tile of the day averaged. Pick a point in the Map view to use one tile instead."}
                </span>
            </>
        ),
    );

    return (
        <>
            <button
                {...tip.trigger}
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label="Pour location"
                onClick={() => {
                    tip.hide();
                    if (open) setOpen(false);
                    else {
                        measure();
                        setOpen(true);
                    }
                }}
                className={cx(
                    "flex h-9 min-w-0 shrink items-center gap-2 rounded-xl px-2.5",
                    "bg-elevate-1 ring-1 ring-inset ring-hairline hover:bg-elevate-2",
                )}
            >
                <span className="relative flex h-2 w-2 shrink-0">
                    {active?.source === "cached" && (
                        <span className="absolute inline-flex h-full w-full rounded-full bg-status-green opacity-40" />
                    )}
                    <span className={cx("relative inline-flex h-2 w-2 rounded-full", dot)} />
                </span>
                <MapPin className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
                <span className="hidden truncate text-[12px] font-medium text-text-secondary lg:inline">
                    {active?.label ?? "Location"}
                </span>
            </button>
            {tip.node}

            {open &&
                rect &&
                createPortal(
                    <LocationPanel
                        ref={panelRef}
                        rect={rect}
                        active={active}
                        durationHours={durationHours}
                        onApply={(response, label) => {
                            onApply(response, label);
                            setOpen(false);
                        }}
                    />,
                    document.body,
                )}
        </>
    );
}

/* ── the picker itself ──────────────────────────────────────────────────────── */

function LocationPanel({
    ref,
    rect,
    active,
    durationHours,
    onApply,
}: {
    ref: React.Ref<HTMLDivElement>;
    rect: DOMRect;
    active: ActiveLocation | null;
    durationHours: number;
    onApply: (response: AmbientResponse, label: string) => void;
}) {
    const [mode, setMode] = useState<Mode>("preset");
    const [presetId, setPresetId] = useState<string>(
        PRESETS.find((p) => p.label === active?.label)?.id ?? PRESETS[0].id,
    );
    // Text, not number: a half-typed "-11" is a valid keystroke and a useless float.
    const [latText, setLatText] = useState(String(active?.lat ?? PRESETS[0].lat));
    const [lonText, setLonText] = useState(String(active?.lon ?? PRESETS[0].lon));
    const [date, setDate] = useState(active?.date ?? "2025-07-15");
    // The hour the pour starts, local clock. It belongs here rather than as a constant
    // somewhere in the request path: it picks where on the diurnal curve the run begins,
    // which is the whole 4am-against-2pm question the solar term exists to answer.
    const [hour, setHour] = useState(active?.placementHour ?? 14);

    // The quote carries the selection it answers. Deriving "still pricing" from a key
    // mismatch rather than a second flag means there is no moment where a stale price
    // and a new selection are both on screen and both look current.
    const [quote, setQuote] = useState<{ key: string; data: AmbientQuote | null } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // a live fetch takes two clicks. The first one only shows the price.
    const [armed, setArmed] = useState(false);

    const preset: Preset | undefined = PRESETS.find((p) => p.id === presetId);
    const lat = mode === "preset" ? preset?.lat : Number(latText);
    const lon = mode === "preset" ? preset?.lon : Number(lonText);
    const label =
        mode === "preset"
            ? (preset?.label ?? "")
            : `${Number(latText).toFixed(2)}, ${Number(lonText).toFixed(2)}`;

    // Client-side validation, BEFORE any request. The backend checks again.
    const numbersOk =
        lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon);
    const box = numbersOk ? coverageBox(lat, lon) : null;
    const when = dateMode(date);
    const dateOk = when === "archive" || when === "forecast";
    const localProblem = !numbersOk
        ? "Latitude and longitude must both be numbers."
        : box === null
          ? "Outside coverage. The temperature API answers for the United States only: the continental US, Alaska and Hawaii."
          : !dateOk
            ? when
            : null;

    // price every selection. Free, because /ambient/quote never calls FortyGuard.
    const key = `${lat},${lon},${date}`;
    useEffect(() => {
        if (localProblem || !numbersOk) return;
        let live = true;
        ambientQuote(lat, lon, date)
            .then((q) => live && setQuote({ key, data: q }))
            .catch(() => live && setQuote({ key, data: null }));
        return () => {
            live = false;
        };
    }, [key, lat, lon, date, localProblem, numbersOk]);

    const shown = localProblem === null && quote?.key === key ? quote.data : null;
    const quoting = localProblem === null && quote?.key !== key;
    // Arming is per selection. Changing anything disarms, so a confirm click can never
    // land on a site-day other than the one whose price was on screen when it was armed.
    const cached = shown?.cached === true;
    const credits = shown?.credits ?? CREDITS_PER_DAY;

    const apply = async () => {
        if (!numbersOk || localProblem) return;
        // Spending needs the second click. The first one only armed the button.
        if (!cached && !armed) {
            setArmed(true);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const response = await buildAmbient({
                lat,
                lon,
                date,
                placement_hour: hour,
                duration_hours: durationHours,
                allow_live: !cached,
            });
            onApply(response, label);
        } catch (err: unknown) {
            setError(err instanceof ApiError ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            ref={ref}
            role="dialog"
            aria-label="Pour location"
            style={{
                position: "fixed",
                right: window.innerWidth - rect.right,
                top: rect.bottom + 6,
                width: 320,
            }}
            className={cx(
                "z-[1000] rounded-xl border border-border-default bg-bg-elevated p-3",
                "shadow-2xl shadow-black/60 ring-1 ring-inset ring-hairline",
                "animate-[select-in_120ms_var(--ease-out-strong)]",
            )}
        >
            <div className="mb-2.5">
                <Segmented<Mode>
                    value={mode}
                    options={[
                        { id: "preset", label: "Preset city" },
                        { id: "coords", label: "Coordinates" },
                    ]}
                    onChange={setMode}
                    label="How to choose the location"
                    size="sm"
                />
            </div>

            {mode === "preset" ? (
                <Row label="City">
                    <Select
                        value={presetId}
                        options={PRESETS.map((p) => ({
                            id: p.id,
                            label: p.label,
                            // Only Phoenix has days on disk. Everything else buys them.
                            note: p.id === "phoenix" ? "cached" : `${CREDITS_PER_DAY}`,
                        }))}
                        onChange={(id) => {
                            setArmed(false);
                            setPresetId(id);
                        }}
                        label="Preset US city"
                        className="w-[180px]"
                    />
                </Row>
            ) : (
                <>
                    <Row label="Latitude">
                        <NumBox
                            value={latText}
                            onChange={(v) => {
                                setArmed(false);
                                setLatText(v);
                            }}
                            step={0.01}
                        />
                    </Row>
                    <Row label="Longitude">
                        <NumBox
                            value={lonText}
                            onChange={(v) => {
                                setArmed(false);
                                setLonText(v);
                            }}
                            step={0.01}
                        />
                    </Row>
                </>
            )}

            <Row label="Date">
                {/* native date input on purpose: it already knows about locales, keyboards
                    and the min/max the archive imposes. */}
                <input
                    type="date"
                    value={date}
                    min={ARCHIVE_START}
                    max={lastAvailableDate()}
                    onChange={(e) => {
                        setArmed(false);
                        setDate(e.target.value);
                    }}
                    aria-label="Pour date"
                    className={cx(
                        "h-7 w-[180px] rounded-md border border-border-default bg-bg-primary px-2",
                        "text-[12px] text-text-secondary focus:border-accent-blue focus:text-text-primary",
                    )}
                />
            </Row>

            <Row label="Start hour">
                <select
                    value={hour}
                    onChange={(e) => {
                        setArmed(false);
                        setHour(Number(e.target.value));
                    }}
                    aria-label="Placement hour, local clock"
                    className={cx(
                        "h-7 w-[180px] rounded-md border border-border-default bg-bg-primary px-2",
                        "text-[12px] text-text-secondary focus:border-accent-blue focus:text-text-primary",
                    )}
                >
                    {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                            {String(h).padStart(2, "0")}:00
                        </option>
                    ))}
                </select>
            </Row>

            {/* what this selection costs, before anything is spent. */}
            <div className="mt-2.5 border-t border-border-default pt-2.5">
                {localProblem ? (
                    <p className="text-[11px] leading-snug text-status-red">{localProblem}</p>
                ) : quoting ? (
                    <p className="text-[11px] text-text-muted">Pricing…</p>
                ) : shown?.reason ? (
                    <p className="text-[11px] leading-snug text-status-red">{shown.reason}</p>
                ) : (
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                            <span
                                className={cx(
                                    "inline-flex h-2 w-2 shrink-0 rounded-full",
                                    cached ? "bg-status-green" : "bg-status-amber",
                                )}
                            />
                            {cached ? "Cached" : "Live"}
                            {shown?.mode && <span className="text-text-muted">· {shown.mode}</span>}
                        </span>
                        <span
                            className={cx(
                                "font-mono text-[11px] tabular-nums",
                                cached ? "text-status-green" : "text-status-amber",
                            )}
                        >
                            {cached ? "0 credits" : `${credits} credits`}
                        </span>
                    </div>
                )}
                {!cached && !localProblem && !shown?.reason && (
                    <p className="mt-1 text-[10px] leading-snug text-text-muted">
                        This day is not on disk. Fetching it spends {credits} credits against the
                        remaining quota.
                    </p>
                )}
            </div>

            {error && <p className="mt-2 text-[11px] leading-snug text-status-red">{error}</p>}

            <button
                type="button"
                onClick={() => void apply()}
                disabled={busy || quoting || localProblem !== null || shown?.reason !== undefined}
                className={cx(
                    "mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg",
                    "text-[12px] font-semibold disabled:opacity-40",
                    cached
                        ? "bg-accent-blue text-bg-primary"
                        : armed
                          ? "bg-status-amber text-bg-primary"
                          : "bg-elevate-1 text-text-secondary ring-1 ring-inset ring-hairline hover:bg-elevate-2",
                )}
            >
                {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                ) : (
                    <MapPin className="h-3.5 w-3.5" strokeWidth={2.5} />
                )}
                {busy
                    ? "Building"
                    : cached
                      ? "Use this location"
                      : armed
                        ? `Confirm — spend ${credits} credits`
                        : `Fetch — ${credits} credits`}
            </button>
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2 py-[3px]">
            <span className="text-[11px] text-text-muted">{label}</span>
            {children}
        </div>
    );
}

function NumBox({
    value,
    onChange,
    step,
}: {
    value: string;
    onChange: (next: string) => void;
    step: number;
}) {
    return (
        <input
            type="number"
            inputMode="decimal"
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cx(
                "h-7 w-[180px] rounded-md border border-border-default bg-bg-primary px-2",
                "font-mono text-[12px] tabular-nums text-text-secondary",
                "focus:border-accent-blue focus:text-text-primary",
            )}
        />
    );
}
