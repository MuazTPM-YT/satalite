// deploy smoke test. nothing but the browser-side health fetch, so a failure here is
// the API origin or CORS and never the viewer.
import HealthProbe from "@/components/HealthProbe";

export default function HealthCheckPage() {
  return <HealthProbe />;
}
