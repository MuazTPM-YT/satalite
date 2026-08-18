# SatAlite

SatAlite predicts how a concrete pour will cure, from hyperlocal air temperature.

Concrete generates its own heat as cement hydrates. How hot the pour gets, how steep the
internal gradients are, and how fast it gains strength all depend on the air around it —
and air temperature varies street by street, not city by city. SatAlite pulls hyperlocal
temperature from the [FortyGuard](https://fortyguard.com) tOS Enterprise API, runs a 2D
finite-difference thermal solver coupled to a Schindler–Folliard cement hydration model,
and reports peak temperature, maximum gradient, and ASTM C1074 maturity-based strength gain.

**Status: scaffold.** Structure and wiring only. The solver, hydration, and maturity
maths are stubs that raise `NotImplementedError` — nothing fabricates a plausible-looking
number before the real physics lands.

## Layout

```
backend/
  app/        FastAPI: routes, config, pydantic models, services
  physics/    pure numpy. never imports fastapi, pydantic, or app/
  vendor/     vendored FortyGuard client (MIT, see credit below)
  tests/      purity + api tests pass now; 4 golden physics tests skipped
frontend/     Next.js 16, TypeScript, Tailwind, App Router
docs/
```

`physics/` purity is enforced by `backend/tests/test_purity.py`, so the physics can be
tested and reviewed in isolation from the web layer.

## Setup

```bash
cp .env.example .env      # then put your FortyGuard API key in it
```

The backend refuses to start without `FORTYGUARD_API_KEY`. That is deliberate — a missing
key fails loudly at startup rather than as a confusing 401 on the first request.

Requires Python 3.12 (fetched automatically by [uv](https://docs.astral.sh/uv/)) and Node 20+.

## Start backend

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/api/health> → `{"status":"ok","version":"0.1.0"}`
Interactive API docs: <http://localhost:8000/docs>

## Start frontend

```bash
cd frontend
npm install
npm run dev
```

<http://localhost:3000>. It reads `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).
With the backend up, the landing page shows `Backend: ok (v0.1.0)`.

## Checks

Backend — lint, types, tests:

```bash
cd backend
uv run ruff check .
uv run mypy physics app     # strict on physics/, lenient elsewhere
uv run pytest -v
```

Expect `9 passed, 4 skipped`. The 4 skips are the golden physics tests in
`tests/test_golden.py`, waiting on the solver.

Frontend — lint, types, build:

```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

## Notes

- **Units are Celsius everywhere.** The vendored client's docstring claims tcm tiles are
  Fahrenheit; that is wrong, verified against live data.
- API responses are cached to `backend/data/cache/` keyed by a hash of the request
  parameters. Quota is limited, so the cache is load-bearing — nothing calls the API twice
  for identical parameters.

## Credit

The FortyGuard API client in `backend/vendor/fortyguard/` is vendored unmodified from
[FortyGuard's temperature-api-quickstart](https://github.com/fortyguard), copyright
FortyGuard, Inc., MIT licensed. Their licence is kept alongside the code at
`backend/vendor/fortyguard/LICENSE`. Thanks to FortyGuard for the API and the quickstart.

SatAlite itself is MIT licensed — see `LICENSE`.
