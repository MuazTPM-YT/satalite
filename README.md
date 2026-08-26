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

**Read [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) before trusting a number.** It lists
what is wrong and which number each item moves: one constant that was fitted against a
validation case, silica fume modelled as inert, a forecast band with zero measured pairs
behind it, a strip time that is a fraction of an unmeasured strength curve, and the fact
that validation stands at 1 of 3. It also says what is solid, because that is true too.

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

## Where the pour is

Location is a control in the command bar, not a caption. The chip next to the health dot
names the active site and says whether its weather came off disk or cost credits — grey
for the artifact's own stated day, green for cached, amber for live.

Latitude is not decoration. It sets solar declination, sunset hour angle and daylength,
so it moves the solar term and with it the whole early-morning-against-afternoon
comparison. `POST /api/ambient` hands the chosen latitude straight to
`physics.season_analysis.build_ambient` and echoes `resolved_lat_deg` back, the same way
`t_ref_c` and `probe_xy_m` are echoed, so you never have to trust that it arrived.

Two hard limits, both the API's rather than ours:

- **Coverage is the United States only.** Coordinates are checked against the continental
  US, Alaska (including the Aleutians east of the antimeridian) and Hawaii, in the browser
  before any request and again at the boundary. Somewhere outside gets a sentence, not a
  stack trace.
- **A day that is not cached costs 4220 credits.** `GET /api/ambient/quote` prices a
  site-day without calling FortyGuard at all, so the picker can ask on every keystroke for
  nothing. `POST /api/ambient` without `allow_live: true` refuses and names the price
  instead of paying it, and the button needs a second, explicit click that says the
  number. Changing any input disarms it.

Archive coverage runs from 2021-01-01; the forecast reaches 12 hours past now. Anything
outside that is refused with the range named.

Only one site-day ships in the container — Phoenix, 2025-07-15, the demo day — so that is
the one selection that is free. Every other preset and every typed coordinate will quote
4220 and wait for you to confirm.

## Seeing the day the solve was given

The **Map** view, third in the view switcher, draws the measured temperature field over
the ground it was measured on: the day's FortyGuard heatmap, 221 tiles at 100 m, on a
pannable basemap with the pour site marked.

It is there because the reduction in between throws almost everything away. `/api/ambient`
hands `physics.season_analysis.build_ambient` three numbers — the tile-mean min, mean and
max — and those three are the whole of what the solver learns about a 2.5 km² city block.
The card on the map names that triple and the spread it came from, so the flattening is
visible rather than implied. On the demo day the daily mean spreads 0.10 °C across the
221 tiles, and the daily max 0.17 °C.

**Click a cell to pour there.** The cell you pick is ringed, the chip in the command bar
names it (`Phoenix, AZ · tile 123`), and the cure re-solves — because `POST /api/ambient`
takes `reduce: "tile"` and shapes the diurnal curve from that one 100 m cell's own
min/mean/max instead of the average of all 221. That is the hyperlocal claim actually
wired to the solver rather than asserted.

Be honest about the size of it: over this AOI — one downtown city block — the two most
different cells are 0.37 °C apart in daily minimum and that moves peak core temperature by
0.048 °C. Real, measurable, and small, because 2.5 km² is small. The response echoes
`reduction` and `tile_id` so a reader always knows which of the two answers is on screen,
and a point that lands outside every tile falls back to the AOI mean and says so.

The default stays `aoi_mean`: every precomputed artifact on disk was built with it, and
silently switching would move numbers that are already written down.

Three controls, and the middle one is the one to read first:

- **Min / Mean / Max** — a `filter_type=3` day carries all three per tile, so switching
  costs nothing and asks a different question. Max is the one the placement limit is read
  against.
- **Stretch / Absolute** — Stretch takes the selected field's own range, which is the only
  way the spatial pattern is visible at a tenth of a degree; the legend then prints two
  decimals so nobody reads it as forty. Absolute spans the whole day, all three fields, so
  one colour means one temperature.
- **Dark / Light / Satellite** — Esri basemaps (Dark Gray Canvas, Light Gray Canvas, World
  Imagery), no API key, attributed on the map because that is the licence condition. Each
  is two layers: cartography under the field, lettering over it, so street names stay
  readable through the heat. This was CARTO, which now stamps `API KEY REQUIRED` across
  every tile it serves without one.

Each basemap declares the deepest zoom it *really* holds — the Canvas services stop at 16
and the imagery at 19, and past that they answer 200 with a blank placeholder. Beyond the
cap the tiles below are scaled up rather than requested, so zooming in to pick one cell
makes the streets soft instead of making them disappear.

### Pointing the map at your own tiles

`frontend/src/lib/basemap.ts` is the whole tile-source layer, and a deployment can replace
it without touching code — set `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION`
(plus optional `NEXT_PUBLIC_MAP_MAX_ZOOM` and `NEXT_PUBLIC_MAP_LABEL`) and the source
appears first in the switcher and becomes the default. See `frontend/.env.local.example`.

The url is a **template** — `{z}`, `{x}`, `{y}` in whatever order your provider uses — so
a keyed provider works by putting the key in it. `NEXT_PUBLIC_*` is inlined at build time,
so it is read by `next build`, not at runtime.

**Attribution is required, and a bad value is refused rather than half-applied.** Every
provider worth using makes attribution a licence condition, so a source configured without
it does not load: the map falls back to the built-in Esri basemaps and the console names
the missing piece. The url is checked for the three placeholders and for an `https://`,
`http://` or `/` prefix before it is ever put in an `<img src>`.

**The map cannot spend a credit.** `GET /api/heatmap` reads the cache and nothing else: a
site-day that is not on disk comes back as a 409 naming the 4220, with a pointer to the
location control, which is the one thing in the app allowed to buy a day. So the map is
free to open as often as you like, and any day the picker has fetched is on it afterwards.

Picking a cell cannot spend one either, silently. Every click is priced first through
`/api/ambient/quote`, which never calls FortyGuard; a free pick applies immediately, and
one that would cost credits waits for a second, explicit press on a button carrying the
number — the same two-click rule as the location picker. Clicks land only on measured
cells: bare ground is not a pick, so a stray click can neither re-solve nor buy anything.

AOI centres are **snapped to a grid one AOI wide** (`snap_to_aoi`). Without it every
distinct coordinate is its own polygon, its own cache key and its own 4220 credits, so
nudging a pour twenty metres down the street would re-buy the day. Phoenix still resolves
to the committed season polygon, which is what keeps the one shipped day free.

The projection is `frontend/src/lib/mercator.ts` — Web Mercator and slippy-map tile cover,
no map library, checked against the spec's own worked tile indices in `test_mercator.ts`.

## The mix

`MixSpec.cementitious_kg_m3` is **total cementitious content** — cement plus fly ash plus
any other SCM. It was called `cement_kg_m3`, which said the opposite of what it held; the
old name is still accepted on the wire so existing payloads keep working.

`silica_fume_frac` is a fraction of that total, and it is carried as **mass with no heat**.
Schindler–Folliard 2005 regresses Class F ash, Class C ash and GGBF slag only — there is
no silica fume term in `H_u`, `tau`, `beta` or `alpha_u` — so counting it as cement
overstates the heat, by 5.95% on the Deer Creek mix.

There is deliberately **no slag field**. Slag is not inert: it carries a 461 J/g heat term,
an `alpha_u` term and a `tau` term. Accepting it without wiring those would under-predict
temperature, which is the direction that misses a DEF flag. Until a validation case
contains slag, a slag mix is not expressible.

## Checks

Backend — lint, types, tests:

```bash
cd backend
uv run ruff check .
uv run mypy physics app     # strict on physics/, lenient elsewhere
uv run pytest -v
```

Expect `222 passed`. `validation/` is deliberately outside `testpaths` — it runs real
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
npx tsx src/lib/test_location.ts          # US coverage bounds, archive/forecast window
npx tsx src/lib/test_mercator.ts          # the map projection, against the slippy-map spec
npx tsx src/lib/test_basemap.ts           # the tile-source override, and what it refuses
```

The `*_live.ts` ones need the backend up, and are how the frontend proves its claims
against real responses rather than against fixtures:

```bash
npx tsx src/lib/test_studio_live.ts       # the studio opens on the artifact's scenario
npx tsx src/lib/test_probe_live.ts        # viewer and solver agree on the same point
npx tsx src/lib/test_shapes_live.ts       # all eight shapes, vertex for vertex
npx tsx src/lib/test_ensemble_live.ts     # nominal under the limit, tail across it
npx tsx src/lib/test_heatmap_live.ts      # the map's field, and that it never spends
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

`PORT` overrides the listening port and defaults to 8000. Cloud Run, Fly and most
container hosts inject the port they want and health-check only that port, so a container
that hardcodes one is marked unhealthy and rolled back with nothing useful in the logs.

The image is a builder/runtime split so uv and the build tooling never ship. Measured on
this project: 970 MB single-stage, 672 MB with the uv cache dropped, **578 MB** as it
stands. That is what a scale-to-zero host pulls on every cold start, and it is the floor
without dropping a feature — scipy is 152 MB and numpy 67 MB of the 260 MB venv.

### Deploying it free

The frontend goes on Vercel. For the backend, the binding number is that **one
deterministic solve is 6.1 s of CPU** (measured: dt = 10 s, 25,920 steps, a 30×300 grid,
433 recorded frames) with a **282 MB peak RSS**. That rules out the obvious free tiers:
Render's free instance is 512 MB and **0.1 CPU**, which turns 6.1 s into roughly a minute,
and it spins down after 15 minutes with a 30–60 s cold start. Hugging Face Spaces now
requires a paid plan for Docker Spaces. Fly.io requires a card on file with no documented
free allowance.

**Google Cloud Run** is the one that works. Its always-free tier is 180,000 vCPU-seconds,
360,000 GiB-seconds and 2M requests a month in US regions — about **29,500 free solves a
month** at 6.1 vCPU-s each, with a real vCPU rather than a tenth of one. Billing has to be
enabled, so a card is on file; set a budget alert and the free tier keeps it at zero.

```bash
# from the repository root — the Dockerfile needs it as build context
gcloud run deploy satalite-api --source . --region us-central1   --memory 1Gi --cpu 1 --concurrency 2 --max-instances 4 --min-instances 0   --timeout 120 --allow-unauthenticated   --set-env-vars ALLOWED_ORIGINS=https://your-frontend.vercel.app   --set-secrets FORTYGUARD_API_KEY=fortyguard-key:latest
```

`--concurrency 2` matters. The solve is CPU-bound and single-threaded, so the default of
80 queues requests behind each other on one vCPU until they all time out.

Deploy the backend first, build the frontend with `NEXT_PUBLIC_API_URL` pointing at it —
it is inlined at **build** time — then redeploy the backend with the real Vercel origin in
`ALLOWED_ORIGINS`. Warm the instance with one `curl` to `/api/health` before a demo;
`--min-instances 0` is what keeps it free, and a single warm-up removes the cold start.

Most of the studio never touches the solver: the season replay, the validation report and
the ensemble band are served straight from disk.

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
