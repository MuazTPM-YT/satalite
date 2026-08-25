// browser-side backend reachability chip. runs in the BROWSER on purpose: this is the
// only call in the app that proves CORS works from a real origin, not Node-to-Node.
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getHealth, type Health } from "@/lib/api";
import { cx } from "@/components/ui";
import { useTooltip } from "@/components/Tooltip";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Probe =
  | { state: "pending" }
  | { state: "ok"; health: Health }
  | { state: "error"; message: string };

export default function HealthProbe() {
  const [probe, setProbe] = useState<Probe>({ state: "pending" });

  // one fetch on mount. failure text is shown verbatim - a CORS block and a dead
  // backend look identical in the UI otherwise, and they need different fixes.
  useEffect(() => {
    let live = true;
    getHealth()
      .then((health) => live && setProbe({ state: "ok", health }))
      .catch((err: unknown) =>
        live && setProbe({ state: "error", message: err instanceof Error ? err.message : String(err) })
      );
    return () => {
      live = false;
    };
  }, []);

  const dot = {
    pending: "bg-text-muted",
    ok: "bg-status-green",
    error: "bg-status-red",
  }[probe.state];

  // The full detail is the tooltip. The chip itself says only whether the backend
  // answered: a version string is metadata about the build, not about the run on
  // screen, and it earned a permanent seat in the command bar it did not deserve.
  const detail =
    probe.state === "ok" ? (
      <>
        <span className="block font-medium text-status-green">Backend reachable</span>
        <span className="mt-0.5 block font-mono text-[10px] text-text-secondary">
          {probe.health.status} · v{probe.health.version}
          <br />
          {API_URL}
        </span>
      </>
    ) : probe.state === "error" ? (
      <>
        <span className="block font-medium text-status-red">Backend unreachable</span>
        <span className="mt-0.5 block font-mono text-[10px] text-text-secondary">
          {API_URL}
          <br />
          {probe.message}
        </span>
      </>
    ) : (
      <>
        <span className="block font-medium">Probing the backend</span>
        <span className="mt-0.5 block font-mono text-[10px] text-text-secondary">
          {API_URL}/api/health
        </span>
      </>
    );

  return <ProbeChip detail={detail} state={probe.state} dot={dot} />;
}

// the chip itself. Split out only so the tooltip hook can be called AFTER the detail
// it describes has been built.
function ProbeChip({
  detail,
  state,
  dot,
}: {
  detail: ReactNode;
  state: Probe["state"];
  dot: string;
}) {
  const tip = useTooltip(detail);
  return (
    <div
      {...tip.trigger}
      className={cx(
        "flex h-9 min-w-0 shrink items-center gap-2 rounded-xl px-2.5",
        "bg-elevate-1 ring-1 ring-inset ring-hairline",
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {state === "ok" && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-status-green opacity-40" />
        )}
        <span className={cx("relative inline-flex h-2 w-2 rounded-full", dot)} />
      </span>
      {state !== "ok" && (
        <span className="hidden truncate font-mono text-[11px] text-text-muted xl:inline">
          {state === "error" ? "unreachable" : "probing…"}
        </span>
      )}
      {tip.node}
    </div>
  );
}
