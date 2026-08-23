# SatAlite

SatAlite predicts how a concrete pour will cure, from hyperlocal air temperature.

Concrete generates its own heat as cement hydrates. How hot the pour gets, how steep the
internal gradients are, and how fast it gains strength all depend on the air around it —
and air temperature varies street by street, not city by city. SatAlite pulls hyperlocal
temperature from the [FortyGuard](https://fortyguard.com) tOS Enterprise API, runs a 2D
finite-difference thermal solver coupled to a Schindler–Folliard cement hydration model,
and reports peak temperature, maximum gradient, and ASTM C1074 maturity-based strength gain.

**Status: solver live.** The 2D masked finite-volume solver, the hydration chain and the
maturity clock are implemented and covered by five golden physics tests — each a
known-answer check against something that does not depend on our implementation. A Monte
Carlo ensemble reports p05/p95 bands over the parameters we genuinely do not know.
Strength calibration is still PROVISIONAL literature defaults, and says so in every
payload that carries a strip time.

## Layout

```
backend/
  app/        FastAPI: routes, config, pydantic models, services
  physics/    pure numpy. never imports fastapi, pydantic, or app/
  vendor/     vendored FortyGuard client (MIT, see credit below)
  tests/      purity, api and five golden physics tests
  validation/ real measured cases, run on purpose: pytest validation/ -m validation
  scripts/    offline builds and measurement harnesses. never on a request path
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

Expect `159 passed`. `validation/` is deliberately outside `testpaths` — it runs real
measured cases and is invoked on purpose:

```bash
uv run pytest validation/ -m validation
```

Frontend — lint, types, build:

```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

## Precomputed answers

Three results are built offline and served straight from disk. None of them changes
between requests, and each is minutes of solving, so none belongs on a request thread.
A missing file is a 503 naming the command that builds it — never a live compute, never
a placeholder.

| Route | File | Built by |
|---|---|---|
| `/api/demo-ensemble` | `backend/data/cache/demo-ensemble.json` | `python -m scripts.build_demo_ensemble` |
| `/api/season-analysis` | `backend/data/cache/season-analysis.json` | `app.services.season.fetch_season` then `physics.season_analysis.season_exposure` |
| `/api/validation` | `docs/VALIDATION.json` | `pytest validation/ -m validation` |

The ensemble is the reason for the split: 2048 samples is minutes of work, while the
deterministic solve behind `POST /api/simulate` is seconds. `POST /api/pour-windows`
takes `ensemble: false` by default for the same reason — ask for the band explicitly, or
read the precomputed one.

**Fetching a season costs real money.** One day is one heatmap at a flat 4220 credits,
so a 92-day season is roughly 388,000 of a ~2,000,000 credit budget. The fetch is
resumable and checks the cache before every call. Do not run it casually.

## Docker

The build context is the **repository root**, not `backend/` — `docs/` holds the
validation report the API serves, and it lives outside `backend/`:

```bash
docker build -f backend/Dockerfile -t satalite .
docker run -p 8000:8000 \
  -e FORTYGUARD_API_KEY=... \
  -e ALLOWED_ORIGINS=https://your-frontend.example.com \
  satalite
```

`ALLOWED_ORIGINS` is not optional for a real deployment. It defaults to localhost, which
passes every test and then fails every browser request in production.

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
