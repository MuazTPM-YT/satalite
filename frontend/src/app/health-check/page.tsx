// deploy smoke test. nothing but the browser-side health fetch, so a failure here is
// the API origin or CORS and never the viewer.
import type { Metadata } from "next";
import HealthProbe from "@/components/HealthProbe";

// A diagnostic endpoint is not a page anyone should reach from a search result.
export const metadata: Metadata = {
  title: "Health check",
  robots: { index: false, follow: false },
};

export default function HealthCheckPage() {
  return <HealthProbe />;
}
