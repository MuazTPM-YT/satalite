// browser-side backend reachability chip. runs in the BROWSER on purpose: this is the
// only call in the app that proves CORS works from a real origin, not Node-to-Node.
"use client";

import { useEffect, useState } from "react";
import { getHealth, type Health } from "@/lib/api";
import { cx } from "@/components/ui";

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

  // The full detail is the title. The chip itself says only whether the backend
  // answered: a version string is metadata about the build, not about the run on
  // screen, and it earned a permanent seat in the command bar it did not deserve.
  const detail =
    probe.state === "ok"
      ? `backend ${probe.health.status} · v${probe.health.version} · ${API_URL}`
      : probe.state === "error"
        ? `backend unreachable · ${API_URL} · ${probe.message}`
        : `probing ${API_URL}/api/health`;

  return (
    <div
      title={detail}
      className={cx(
        "flex h-9 min-w-0 shrink items-center gap-2 rounded-xl px-2.5",
        "bg-elevate-1 ring-1 ring-inset ring-hairline",
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {probe.state === "ok" && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-status-green opacity-40" />
        )}
        <span className={cx("relative inline-flex h-2 w-2 rounded-full", dot)} />
      </span>
      {probe.state !== "ok" && (
        <span className="hidden truncate font-mono text-[11px] text-text-muted xl:inline">
          {probe.state === "error" ? "unreachable" : "probing…"}
        </span>
      )}
    </div>
  );
}
