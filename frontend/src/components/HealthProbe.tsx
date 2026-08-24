// browser-side backend reachability chip. runs in the BROWSER on purpose: this is the
// only call in the app that proves CORS works from a real origin, not Node-to-Node.
"use client";

import { useEffect, useState } from "react";
import { getHealth, type Health } from "@/lib/api";

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

  const dot =
    probe.state === "ok" ? "#3fb950" : probe.state === "error" ? "#f85149" : "#8b949e";

  return (
    <div
      className="inline-flex items-center gap-2 px-2 py-1 rounded-sm bg-bg-primary border border-border-default text-[10px] tabular-nums max-w-[420px]"
      title={API_URL}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
      <span className="text-text-secondary truncate">
        {probe.state === "pending" && `probing ${API_URL}/api/health`}
        {probe.state === "ok" && `backend ${probe.health.status} · v${probe.health.version} · ${API_URL}`}
        {probe.state === "error" && `backend unreachable · ${API_URL} · ${probe.message}`}
      </span>
    </div>
  );
}
