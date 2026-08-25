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

Two env files, and they are not interchangeable. The backend reads the one at the repo
root; Next only ever reads files under `frontend/`, so a `NEXT_PUBLIC_*` written at the
root is inert.

```bash
cp .env.example .env                                # backend: API key, cache, CORS
cp frontend/.env.local.example frontend/.env.local  # frontend: which backend to call
```

Put your FortyGuard key in `.env`. The backend refuses to start without
`FORTYGUARD_API_KEY` — a missing key fails loudly at startup rather than as a confusing
401 on the first request.

Requires Python 3.12 (fetched automatically by [uv](https://docs.astral.sh/uv/)) and Node 20+.

## Run it

Two processes, two terminals. Start the backend first — the studio's first paint is a
solve, so a frontend with no backend behind it shows the error rather than a drawing.

**Terminal 1 — backend on :8000**

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/api/health> → `{"status":"ok","version":"0.1.0"}`
Interactive API docs: <http://localhost:8000/docs>

**Terminal 2 — frontend on :3000**

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. With the backend up, the status dot at the right of the
command bar is green, and hovering it names the version and the origin it reached. Red
means the fetch failed, and the tooltip carries the reason verbatim — a CORS block and a
dead backend look identical otherwise, and they need different fixes.

### The two ports have to agree

`ALLOWED_ORIGINS` in `.env` defaults to `http://localhost:3000,http://127.0.0.1:3000`,
and the browser blocks a cross-origin fetch the server has not named. So if you move
either side, move both:

```bash
# frontend somewhere else? name it on the backend.
ALLOWED_ORIGINS=http://localhost:3001

# backend somewhere else? name it in frontend/.env.local, and REBUILD if not in dev.
NEXT_PUBLIC_API_URL=http://localhost:8001
```

Next 16 also holds a one-dev-server lock per directory: a second `npm run dev` from
`frontend/` refuses and prints the port and PID of the one already running.

### Production build

`NEXT_PUBLIC_*` is inlined at **build** time, so both must be set before `next build` —
editing `.env.local` afterwards changes nothing:

```bash
cd frontend
npm run build
npm start                 # serves the built app on :3000
```

`NEXT_PUBLIC_SITE_URL` (default `http://localhost:3000`) is read only by the metadata:
the canonical URL, Open Graph, `robots.txt` and `sitemap.xml` are all absolute, and a
crawler cannot resolve a relative one.

## Checks

Backend — lint, types, tests:

```bash
cd backend
uv run ruff check .
uv run mypy physics app     # strict on physics/, lenient elsewhere
uv run pytest -v
```

Expect `203 passed`. `validation/` is deliberately outside `testpaths` — it runs real
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

The studio also carries self-checks in `frontend/src/lib/`. They are plain scripts, not a
test framework — run the one you want:

```bash
cd frontend
npx tsx src/lib/test_scenario.ts          # candidate start hours, config round trip
npx tsx src/lib/test_section_metrics.ts   # probe distances, cut volumes, elevations
npx tsx src/lib/test_probe.ts             # the probe stencil, against the backend's
npx tsx src/lib/test_extrude.ts           # the extrusion carries no gradient along z
npx tsx src/lib/test_stats.ts             # Wilson interval at 0/n and n/n
```

The `*_live.ts` ones need the backend up, and are how the frontend proves its claims
against real responses rather than against fixtures:

```bash
npx tsx src/lib/test_studio_live.ts       # the studio opens on the artifact's scenario
npx tsx src/lib/test_probe_live.ts        # viewer and solver agree on the same point
npx tsx src/lib/test_shapes_live.ts       # all eight shapes, vertex for vertex
npx tsx src/lib/test_ensemble_live.ts     # nominal under the limit, tail across it
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

The image is the **backend only**. The frontend is a Next build served however you like
— see [Production build](#production-build) — and whatever origin it ends up on has to
be named in `ALLOWED_ORIGINS` below.

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
