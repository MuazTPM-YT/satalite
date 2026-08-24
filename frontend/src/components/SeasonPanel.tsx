// season replay. Which decision the season actually supports, and which it does not.
//
// Four flags were evaluated across the sampled days. Only ONE of them separates the two
// placement hours; the other three fire identically at both and therefore carry no
// information about when to pour this element. Presenting four rows as if they were four
// decision signals is how "unsafe, always" gets read as advice.
"use client";

import type { SeasonAnalysisResponse, SeasonHourStats } from "@/lib/api";
import { wilson, countFromPct } from "@/lib/stats";
import { SectionLabel } from "@/components/ui";

interface SeasonPanelProps {
  season: SeasonAnalysisResponse;
}

// the four flags the replay counts, in the response's own key names
const FLAGS = [
  { key: "pct_days_breaching_placement", label: "Placement", limit: "placement_c" },
  { key: "pct_days_breaching_cracking", label: "Cracking differential", limit: "cracking_diff_c" },
  { key: "pct_days_breaching_evaporation", label: "Evaporation", limit: "evaporation_kg_m2_h" },
  { key: "pct_days_breaching_def", label: "DEF", limit: "def_c" },
] as const;

export default function SeasonPanel({ season }: SeasonPanelProps) {
  // available=false is a STATE served at 200, not a failure. Say what is absent and how
  // to make it, and draw nothing else.
  if (!season.available) {
    return (
      <div className="h-full w-full overflow-y-auto bg-bg-surface p-4">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-text-primary">
            No season replay in this build
          </p>
          <p className="mt-2 text-xs text-text-secondary leading-relaxed">
            {season.detail ?? "The backend reported the artifact as unavailable."}
          </p>
          <p className="mt-3 text-[10px] text-text-muted leading-relaxed">
            This is a 200 with the data absent, not an error. Nothing is being estimated in
            its place.
          </p>
        </div>
      </div>
    );
  }

  const hours = season.placement_hours ?? [];
  const per = season.per_placement_hour ?? {};
  const n_days = season.n_days ?? 0;
  const delta = season.delta_14_minus_04 ?? {};

  // a flag discriminates only if the two hours disagree about it
  const discriminating = FLAGS.filter(({ key }) => {
    const vals = hours.map((h) => per[String(h)]?.[key]);
    return new Set(vals).size > 1;
  });
  const constant = FLAGS.filter((f) => !discriminating.includes(f));

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-surface">
      <div className="p-3">
        {/* what the sample actually is, before any number is read off it */}
        <Sampling season={season} />

        {/* the one flag that separates the hours */}
        <div className="mt-3">
          <SectionTitle
            title="Discriminating on this element"
            subtitle="the two placement hours disagree about these"
          />
          {discriminating.length === 0 ? (
            <p className="text-xs text-text-secondary">
              No flag separates the placement hours in this replay.
            </p>
          ) : (
            discriminating.map((f) => (
              <FlagRow key={f.key} flag={f} hours={hours} per={per} n_days={n_days} />
            ))
          )}

          {/* the continuous quantities behind the placement split */}
          <div className="mt-2 p-2.5 rounded-lg border border-border-default bg-elevate-1">
            <SectionLabel className="mb-1.5">delta_14_minus_04</SectionLabel>
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[11px] tabular-nums">
              {Object.entries(delta).map(([k, v]) => (
                <Fragmented key={k} label={k} value={v} />
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-text-muted leading-relaxed">
              Reported as 14:00 minus 04:00. A positive mean_peak_core_temp_c means the
              afternoon pour runs hotter by that many °C, averaged over the sampled days.
            </p>
          </div>
        </div>

        {/* the three that fire the same way whatever you do */}
        <div className="mt-3">
          <SectionTitle
            title="Not discriminating on this element"
            subtitle="identical at both placement hours — context, not a decision signal"
          />
          {constant.map((f) => (
            <FlagRow key={f.key} flag={f} hours={hours} per={per} n_days={n_days} />
          ))}
          <p className="mt-1.5 text-[10px] text-text-muted leading-relaxed">
            These rows describe the element and the season, not the choice of hour. A row
            reading the same at every option cannot rank the options — treating one as a
            recommendation reads a constant as a signal.
          </p>
        </div>

        {/* per-hour continuous quantities */}
        <div className="mt-3">
          <SectionTitle title="Per placement hour" subtitle="means over the sampled days" />
          <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="text-[9px] uppercase tracking-[0.06em] text-text-muted">
                <th className="text-left py-1 pr-3 font-medium">field</th>
                {hours.map((h) => (
                  <th key={h} className="text-right py-1 pr-3 font-medium">
                    {String(h).padStart(2, "0")}:00
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  "mean_peak_core_temp_c",
                  "mean_max_core_temp_anywhere_c",
                  "mean_strip_time_h",
                  "median_strip_time_h",
                  "n_days_never_stripped",
                ] as const
              ).map((field) => (
                <tr key={field} className="border-t border-hairline">
                  <td className="py-1 pr-3 text-text-muted">{field}</td>
                  {hours.map((h) => {
                    const v = per[String(h)]?.[field];
                    return (
                      <td key={h} className="py-1 pr-3 text-right text-text-primary">
                        {typeof v === "number" ? v.toFixed(field.includes("n_days") ? 0 : 3) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <Context season={season} />
      </div>
    </div>
  );
}

// the shape of the sample. This goes FIRST: "30 days" reads as a covered month unless
// the stride and the span are sitting next to it.
function Sampling({ season }: { season: SeasonAnalysisResponse }) {
  const s = season.sampling;
  const range = season.date_range;
  return (
    <div className="rounded-lg border border-border-default bg-elevate-1 p-2.5">
      <SectionLabel className="mb-1.5">What was sampled</SectionLabel>
      {s ? (
        <>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] tabular-nums">
            <span className="text-text-muted">n_days</span>
            <span className="text-text-primary">{s.n_days}</span>
            <span className="text-text-muted">span_days</span>
            <span className="text-text-primary">{s.span_days}</span>
            <span className="text-text-muted">consecutive</span>
            <span className={s.consecutive ? "text-text-primary" : "text-status-amber"}>
              {String(s.consecutive)}
            </span>
            <span className="text-text-muted">stride_days</span>
            <span className="text-text-primary">{s.stride_days}</span>
            <span className="text-text-muted">coverage_pct</span>
            <span className="text-text-primary">{s.coverage_pct?.toFixed(2)}</span>
            {range && (
              <>
                <span className="text-text-muted">date_range</span>
                <span className="text-text-primary">
                  {range[0]} → {range[1]}
                </span>
              </>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-text-secondary leading-relaxed">
            {s.n_days} days drawn every {s.stride_days}rd day across a {s.span_days}-day span —{" "}
            <span className="text-status-amber">
              {s.coverage_pct?.toFixed(2)}% of the days in that window
            </span>
            . Not {s.n_days} consecutive days, and not a covered month. Consecutive-day
            effects, and anything shorter than the stride, are invisible to this sample.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-status-amber">
          No sampling block in this artifact — how the days were drawn is unknown, so no
          fraction below should be read as a rate over a period.
        </p>
      )}
    </div>
  );
}

// one flag across the placement hours, with a Wilson interval per hour
function FlagRow({
  flag,
  hours,
  per,
  n_days,
}: {
  flag: { key: keyof SeasonHourStats; label: string; limit: string };
  hours: number[];
  per: Record<string, SeasonHourStats>;
  n_days: number;
}) {
  return (
    <div className="mt-1.5 rounded-lg border border-border-default bg-elevate-1 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-text-primary">{flag.label}</span>
        <span className="text-[10px] text-text-muted">{flag.key}</span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {hours.map((h) => {
          const stats = per[String(h)];
          const pct = stats?.[flag.key];
          const n = stats?.n_days ?? n_days;
          const k = typeof pct === "number" ? countFromPct(pct, n) : null;
          const ci = k === null ? null : wilson(k, n);
          return (
            <div key={h} className="flex items-baseline gap-2 text-[11px] tabular-nums">
              <span className="text-text-muted w-12 shrink-0">
                {String(h).padStart(2, "0")}:00
              </span>
              <span className="text-text-primary w-14 shrink-0">
                {typeof pct === "number" ? `${pct.toFixed(1)}%` : "—"}
              </span>
              <span className="text-text-muted w-14 shrink-0">
                {k === null ? "" : `${k}/${n}`}
              </span>
              {/* the bar is the INTERVAL, not the point estimate */}
              <span className="relative flex-1 h-2 rounded-sm bg-bg-primary min-w-[80px]">
                {ci && (
                  <>
                    <span
                      className="absolute top-0 bottom-0 rounded-sm bg-accent-blue/60"
                      style={{ left: `${ci.lo * 100}%`, width: `${Math.max(1, (ci.hi - ci.lo) * 100)}%` }}
                    />
                    <span
                      className="absolute top-0 bottom-0 w-px bg-text-primary"
                      style={{ left: `${(k! / n) * 100}%` }}
                    />
                  </>
                )}
              </span>
              <span className="text-text-secondary w-28 shrink-0 text-right">
                {ci ? `${(ci.lo * 100).toFixed(1)}–${(ci.hi * 100).toFixed(1)}%` : "no interval"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 text-[9px] text-text-muted">
        95% Wilson score interval. Wald is not used: every fraction here is 0 or 1, where
        Wald has zero width and would assert certainty from {n_days} observations.
      </div>
    </div>
  );
}

// limits, element and the assumptions the whole replay is conditional on
function Context({ season }: { season: SeasonAnalysisResponse }) {
  const a = season.assumptions;
  return (
    <div className="mt-3 p-2.5 rounded-lg border border-border-default bg-elevate-1 text-[10px]">
      <div className="font-semibold uppercase tracking-[0.08em] text-text-secondary mb-1.5">
        Element, limits and assumptions
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <KV obj={season.element} title="element" />
        <KV obj={season.limits as Record<string, unknown> | null} title="limits" />
      </div>
      {a && (
        <div className="mt-2 pt-2 border-t border-hairline">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
            {(
              ["rh_frac", "wind_ms", "cloud_pct", "ghi_daylight_w_m2", "placement_above_ambient_c"] as const
            ).map((k) =>
              a[k] === undefined ? null : (
                <Fragmented key={k} label={k} value={a[k] as number} />
              ),
            )}
          </div>
          {a.note && (
            <p className="mt-2 text-status-amber leading-relaxed">{a.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

function KV({ obj, title }: { obj: Record<string, unknown> | null; title: string }) {
  if (!obj) return null;
  return (
    <div>
      <div className="text-text-muted mb-1">{title}</div>
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="flex gap-2 py-0.5">
          <span className="text-text-muted shrink-0">{k}</span>
          <span className="text-text-secondary break-all ml-auto text-right tabular-nums">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Fragmented({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary text-right">
        {Number.isInteger(value) ? value : value.toFixed(3)}
      </span>
    </>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-1">
      <SectionLabel>{title}</SectionLabel>
      <span className="text-[10px] text-text-muted">{subtitle}</span>
    </div>
  );
}
