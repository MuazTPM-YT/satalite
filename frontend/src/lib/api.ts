// backend origin. set NEXT_PUBLIC_API_URL in .env.local
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Health = {
  status: string;
  version: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// typed fetch. throws on non-2xx so callers never read a half-broken body.
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiError(`${init?.method ?? "GET"} ${path} -> ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

// is backend alive
export function getHealth(): Promise<Health> {
  return apiFetch<Health>("/api/health");
}
