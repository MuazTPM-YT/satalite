import { getHealth } from "@/lib/api";

// landing page. only job right now is proving backend is reachable.
export default async function Home() {
  let backend: string;
  try {
    const health = await getHealth();
    backend = `ok (v${health.version})`;
  } catch {
    backend = "unreachable";
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Concrete curing, from hyperlocal air temperature
      </h1>
      <p className="mt-2 text-sm opacity-70">Backend: {backend}</p>
    </div>
  );
}
