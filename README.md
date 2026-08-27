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
behind it, a strip time that is a fraction of an unmeasured strength curve, a time to peak
that runs a mean 8.7 h late across seven measured field elements, a core-to-surface
differential that over-reads those same elements by 24 to 36 °C, and the fact that
validation stands at 1 of 3. It also says what is solid, because that is true too.

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

Expect `228 passed`. `validation/` is deliberately outside `testpaths` — it runs real
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
deterministic solve is 6.14 s of wall time on one core** — measured through
`POST /api/simulate`, four warm runs at 6.154 / 6.135 / 6.130 / 6.149 s, dt = 10 s, 25,920
steps, a 30×300 grid, 433 recorded frames — with a **285 MiB peak RSS** (`VmHWM:
291,388 kB` on the uvicorn worker). That rules out the obvious free tiers: Render's free
instance is 512 MB and **0.1 CPU**, which turns 6.14 s into roughly a minute, and it spins
down after 15 minutes with a 30–60 s cold start. Hugging Face Spaces now requires a paid
plan for Docker Spaces. Fly.io requires a card on file with no documented free allowance.

**Google Cloud Run** is the one that works. Its always-free tier is 180,000 vCPU-seconds,
360,000 GiB-seconds and 2M requests a month in Tier 1 US regions — about **29,300 free
solves a month** at 6.14 vCPU-s each, with a real vCPU rather than a tenth of one. Billing
has to be enabled, so a card is on file; set a budget alert and the free tier keeps it at
zero.

Build and push explicitly — **`--source` cannot be used here.** It only auto-detects a
Dockerfile in the *source root*, and this one is at `backend/Dockerfile` while its build
context has to be the repository root, because `docs/VALIDATION.json` lives outside
`backend/`. Point `--source` at the root and Cloud Build finds no Dockerfile, falls through
to buildpacks, finds no Python project there either, and fails.

```bash
# from the repository root — the Dockerfile needs it as build context
IMAGE=us-central1-docker.pkg.dev/$PROJECT/satalite/api:v1
gcloud auth configure-docker us-central1-docker.pkg.dev
docker build -f backend/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"

gcloud run deploy satalite-api --image "$IMAGE" --region us-central1 \
  --memory 1Gi --cpu 1 --concurrency 2 --max-instances 4 --min-instances 0 \
  --timeout 120 --allow-unauthenticated \
  --set-env-vars ALLOWED_ORIGINS=https://your-frontend.vercel.app \
  --set-secrets FORTYGUARD_API_KEY=fortyguard-key:latest
```

`--concurrency 2` matters. The solve is CPU-bound and single-threaded, so the default of
80 queues requests behind each other on one vCPU until they all time out.

**No credit card?** Cloud Run needs billing enabled even to stay at zero. The card-free
option is Vercel's Python runtime, which happens to fit this repo almost unchanged: it
looks for an entrypoint at `app/main.py` with a top-level `app`, reads dependencies from
`pyproject.toml`, defaults to Python 3.12, allows a 500 MB bundle and a 300 s request. It
costs you the live FortyGuard fetch — the filesystem is read-only, and `cached_call`
writes *after* the API returns, so a live day would spend 4220 credits and then fail to
save. Cached days, and every precomputed route, work fine.

Deploy the backend first, build the frontend with `NEXT_PUBLIC_API_URL` pointing at it —
it is inlined at **build** time — then redeploy the backend with the real Vercel origin in
`ALLOWED_ORIGINS`. Warm the instance with one `curl` to `/api/health` before a demo;
`--min-instances 0` is what keeps it free, and a single warm-up removes the cold start.

Most of the studio never touches the solver: the season replay, the validation report and
the ensemble band are served straight from disk.

## One real FortyGuard call

This is the request that bought the demo day, and the response it came back with. Nothing
here is illustrative — the response below is read straight out of
`backend/data/cache/heatmap-73ed3878b2fa10b340a54c677a84397e16526f30862c61b9d176b7bcfdd9ba47.json`,
which is committed on purpose so the demo runs with no network and no credits.

**The request.** One heatmap over downtown Phoenix for 2025-07-15, at 100 m:

```bash
curl -X POST https://api.fortyguard.com/v1/heatmap \
  -H "api-key: $FORTYGUARD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "polygon_aoi": {
      "type": "FeatureCollection",
      "features": [{
        "type": "Feature",
        "properties": {},
        "geometry": {
          "type": "Polygon",
          "coordinates": [[
            [-112.08673519715168, 33.46131041281569],
            [-112.06844426969921, 33.46131041281569],
            [-112.06844426969921, 33.44790559096451],
            [-112.08673519715168, 33.44790559096451],
            [-112.08673519715168, 33.46131041281569]
          ]]
        }
      }]
    },
    "date_time": { "start_date": "2025-07-15", "filter_type": 3 },
    "granularity": 100,
    "analytic_type": "tcm"
  }'
```

Auth is an **`api-key` header, not `Authorization: Bearer`** — that is the first thing to
get wrong. `filter_type: 3` is one whole day, and it returns per-tile min, mean **and**
max in a single call; asking for the three separately would cost three times 4220 credits
for the same three numbers.

**The submission returns a task, not a heatmap.** Every analysis endpoint is async:

```json
{ "data": { "activity_id": "4de0ef74-3555-4df5-a5a8-215cf9d87a3e" } }
```

Then poll `GET /v1/status/{activity_id}` (same `api-key` header) every 3 s until
`data.status` reaches `succeeded`/`completed`, at which point `data.result` carries the
payload. `create_heatmap(..., wait=True)` does that loop for you and hands back
`{"activity_id": ..., "result": ...}`, which is the shape written to disk.

**The response.** 221 tiles at 100 m over 2.53 km², abridged to one tile and the stats
block — everything shown is verbatim:

```json
{
  "activity_id": "4de0ef74-3555-4df5-a5a8-215cf9d87a3e",
  "result": {
    "map_data": {
      "type": "FeatureCollection",
      "features": [
        {
          "id": "0",
          "type": "Feature",
          "properties": {
            "tile_id": 0,
            "average_temperature": 37.0027,
            "min_temperature": 32.7982,
            "max_temperature": 40.2827
          },
          "geometry": {
            "type": "Polygon",
            "coordinates": [[
              [-112.08639937386151, 33.44991068739647],
              [-112.08532986929018, 33.44992005425784],
              [-112.08534085966070, 33.45080229334947],
              [-112.08641037505697, 33.45079292617626],
              [-112.08639937386151, 33.44991068739647]
            ]]
          }
        }
        // ... 220 more tiles
      ]
    },
    "stats_data": {
      "temperature_stats": {
        "minimum": 36.9076,
        "maximum": 37.0069,
        "mean": 36.94892262443439,
        "standard_deviation": 0.03269454825820848
      }
    }
  }
}
```

**Those numbers are CELSIUS.** The vendored client's docstring says `tcm` tiles are
Fahrenheit and it is wrong — 32.8–40.3 is a Phoenix day in July in °C (91–104 °F); read as
Fahrenheit they would be 0.4–4.6 °C in the middle of an Arizona summer. This is checked in
`app/services/fg_client.py` and it is the single unit error most likely to produce
confidently wrong output here.

Note also what `stats_data.temperature_stats` describes: it is the spread of the **mean**
field across the 221 tiles, 36.9076 to 37.0069 — the 0.10 °C figure quoted further up.

**What the solver actually receives.** `app/services/season.py::day_record` reduces those
221 features to a tile-mean triple, and those three numbers are the whole of what
`physics.season_analysis.build_ambient` learns about the block:

```json
{
  "date": "2025-07-15",
  "day_of_year": 196,
  "t_min_c": 32.77782805429864,
  "t_mean_c": 36.94892262443439,
  "t_max_c": 40.20462081447964,
  "n_tiles": 221
}
```

That reduction is why the Map view exists — it draws the 221 tiles the three numbers came
from, and picking one cell re-solves from that cell's own triple instead of the mean.

To reproduce it without spending anything, with the repo set up as above:

```bash
cd backend
uv run python -c "
from app.services.season import DOWNTOWN_PHOENIX, day_params, day_record
from app.services.fg_client import fetch_heatmap
print(day_record('2025-07-15', fetch_heatmap(day_params(DOWNTOWN_PHOENIX, '2025-07-15'))))
"
```

It prints the triple above and no call leaves the machine — `cached_call` finds the file
and returns it (under the server's logging config the same hit reads
`cache hit heatmap-73ed3878....json`). Delete that file and the identical command costs
**4220 credits**.

## Notes

- **Units are Celsius everywhere.** The vendored client's docstring claims tcm tiles are
  Fahrenheit; that is wrong, verified against live data.
- API responses are cached to `backend/data/cache/` keyed by a hash of the request
  parameters. Quota is limited, so the cache is load-bearing — nothing calls the API twice
  for identical parameters.

## AI tools used

Written with [Claude Code](https://claude.com/claude-code) (Anthropic) as the primary
assistant: implementation, refactoring, test scaffolding and this documentation. The
repository was started from an empty directory on 18 August 2026. The only code not
written here is the vendored FortyGuard client credited below, and the stock
`create-next-app` scaffold under `frontend/`.

What the assistant was *not* allowed to decide: every physics constant in
`physics/constants.py` carries the standard it came from (ASTM C1074, USBR DSO-12-02,
Schindler & Folliard 2005, ACI 207/305/347), and the five golden tests in
`backend/tests/test_golden.py` check the solver against closed-form arithmetic and exact
identities rather than against any number this code produced. Where a constant is
provisional or a limit is unmeasured, `docs/LIMITATIONS.md` says so and says which number
it moves.

## Sources

Everything SatAlite is built on or measured against. Every link here was fetched on
2026-08-27. Standards behind a paywall link to the publisher's page, not to a copy.

### Temperature data

| Source | What it gives us | Link |
|---|---|---|
| **FortyGuard tOS Enterprise API** | Hyperlocal air temperature 2 m above ground, 100 m tiles, US only. The heatmap the demo day comes from. Archive from 2021-01-01, forecast to +12 h. | <https://fortyguard.com> |
| **Open-Meteo Historical Weather API** | Free, no key, hourly back to 1940, worldwide. Supplies the five arrays `AmbientSpec` needs, and the **wind** and **hourly GHI** FortyGuard does not carry at all. Used for the Alabama validation runs, whose 2015–2016 dates predate the FortyGuard archive. | <https://open-meteo.com/en/docs/historical-weather-api> |

### Ground truth — measured concrete, not modelled

| Source | What it gives us | Link |
|---|---|---|
| **USBR DSO-12-02** — Bartojay, K. (2012), *Thermal Properties of Reinforced Structural Mass Concrete*, US Bureau of Reclamation. **Public domain.** | The three cases in `backend/validation/cases/`, run by `pytest validation/ -m validation` and served at `/api/validation`. Also the DEF threshold and the in-situ vs fog-cured strength comparison. | <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-12-02.pdf> |
| **ALDOT 930-860R** — Gross, E. D., Eiland, A. D., Schindler, A. K. & Barnes, R. W. (December 2017), *Temperature Control Requirements for the Construction of Mass Concrete Members*, Auburn University Highway Research Center. | Seven instrumented Alabama DOT mass-concrete elements: mix proportions, mill certificates, placement conditions, measured peak temperature and differential — **and a published ConcreteWorks accuracy assessment on the same seven**. Nothing in this codebase has ever been fitted to them. Behind `docs/LIMITATIONS.md` §9 and §10. | <https://eng.auburn.edu/files/centers/hrc/930-860r-temperature-control.pdf> · [ROSAP mirror](https://rosap.ntl.bts.gov/view/dot/42366) |

### Physics and standards — where every constant comes from

| What it fixes in the code | Source | Link |
|---|---|---|
| Hydration model: the `α_u`, `H_u`, `τ` and `β` regressions in `physics/equations/hydration.py` | Schindler, A. K. & Folliard, K. J. (2005), *Heat of Hydration Models for Cementitious Materials*, **ACI Materials Journal 102(1), 24–33** | [ACI abstract](https://www.concrete.org/publications/internationalconcreteabstractsportal.aspx?m=details&id=14246) |
| Maturity and equivalent age: `EA_BASE = 33500`, datum −10 °C, the 20 °C slope breakpoint | **ASTM C1074**, *Standard Practice for Estimating Concrete Strength by the Maturity Method* | <https://www.astm.org/c1074-19.html> |
| Evaporation limit and the Uno equation, checked against the standard's own 0.17 lb/ft²/h worked example | **ACI 305.1-14**, *Specification for Hot Weather Concreting*; ACI 305R guide | [ACI 305.1](https://www.concrete.org/store/productdetail.aspx?ItemID=305114) |
| `CRACK_LIMIT_C = 19.4` (35 °F) and the 160 °F in-place maximum | **ACI 301**, *Specifications for Structural Concrete*; **ACI 207.2R**, *Report on Thermal and Volume Change Effects on Cracking of Mass Concrete* | [ACI 207.2R](https://www.concrete.org/store/productdetail.aspx?ItemID=207207) |
| Cold-weather placement | **ACI 306.1** | [ACI SPEC-306.1-90](https://www.concrete.org/store/productdetail.aspx?ItemID=306190) |
| `STRIP_FRACTION = 0.75`, formwork removal | **ACI 347**, *Guide to Formwork for Concrete* | [ACI 347](https://www.concrete.org/store/productdetail.aspx?ItemID=34714) |
| `DEF_LIMIT_C = 68.3` (155 °F) and the chemistry conditionality in `physics/limits.py` | USBR DSO-12-02 (above) | <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-12-02.pdf> |

**Read this next to that table.** `docs/LIMITATIONS.md` closes by noting that
`physics/constants.py` names the *standard* a group of constants came from but not the page,
table or equation for each individual number, and that two carry PROVISIONAL markers rather
than citations: `BETA_DEFAULT = 0.9` ("eqn [11] SO3 exponent sign unconfirmed") and
`PLACEMENT_MAX_C = 32.0` ("ACI 305, often project-specific"). Anyone auditing a single
constant has to find it in the source themselves.

### Prior art we measure against

| Tool | What it is | Link |
|---|---|---|
| **ConcreteWorks** | The benchmark. TxDOT-funded, built at UT Austin's Concrete Durability Center; free; used by TxDOT, Iowa DOT and others. Its published error on the seven ALDOT elements is what SatAlite's 5.40 °C is quoted against. | [TxDOT presentation](https://www.dot.state.tx.us/iheep2009/presentations/4A_ConcreteWorks_AndyNaranjo.pdf) |
| **TxDOT 0-4563-1**, *Prediction Model for Concrete Behavior* (Oct 2007, rev. May 2008) | The UT Austin report ConcreteWorks was built from — the provenance chain for its physics. | <https://library.ctr.utexas.edu/ctr-publications/0-4563-1.pdf> |
| **HIPERPAV III** | FHWA's free early-age pavement tool: transient 1D finite difference with hydration, convection, solar and evaporative cooling. Nearly the same physics stack, one dimension fewer, federally validated. | [FHWA](https://www.fhwa.dot.gov/pavement/concrete/hiperpav.cfm) · [manual FHWA-HRT-14-087](https://www.fhwa.dot.gov/publications/research/infrastructure/pavements/14087/14087.pdf) |
| **b4cast** | Commercial 3D FE thermal and stress analysis of hardening concrete. The consultant-grade end of the market. | <https://b4cast.com/> |

### Further reading behind the framing

Not wired to a constant, but this is the literature the problem statement rests on.

| Topic | Source | Link |
|---|---|---|
| DEF in the field — the Texas precast box-beam case | UT Austin CTR 0-5218-1, *Investigation of the Internal Stresses Caused by Delayed Ettringite Formation* | <https://library.ctr.utexas.edu/ctr-publications/0-5218-1.pdf> |
| DEF and ASR field survey | UT Austin CTR 0-4085-1 | <https://library.ctr.utexas.edu/ctr-publications/0-4085-1.pdf> |
| Mass concrete thermal management, and what cooling costs | GDOT Research Project 19-04 Phase II, *Investigation and Guidelines for Best Practices of Mass Concrete Construction Management* | <https://rosap.ntl.bts.gov/view/dot/64459/dot_64459_DS1.pdf> |
| Alternative thermal property models | USBR **DSO-2017-05**, *Comparison of Thermal Property Models for Concrete* | <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-2017-05.pdf> |
| Temperature rise with Class N pozzolan | USBR **DSO-2017-04** | <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-2017-04.pdf> |
| Maturity for early opening — a DOT that measured the payoff | Iowa State InTrans, *Maturity Method for Early Opening of Concrete Pavements* (Spring 2025) | <https://www.intrans.iastate.edu/wp-content/uploads/2025/04/maturity_method_for_concrete_pvmt_early_opening_spring_2025_MB.pdf> |
| Maturity in practice, WSDOT | *Use of the Maturity Method in Accelerated PCCP Construction* | <https://www.wsdot.wa.gov/research/reports/fullreports/698.1.pdf> |
| Maturity in practice, Louisiana | LTRC, *Implementation of Maturity for Concrete Strength Measurement and Pay* | <https://rosap.ntl.bts.gov/view/dot/34372> |
| FHWA's own maturity guidance | FHWA HIF-19-005, *Utilizing the Maturity Concept for Determining Early Strength* | <https://www.fhwa.dot.gov/pavement/concrete/trailer/resources/hif19005.pdf> |
| One-page industry explainer of thermal cracking | NRMCA **CIP 42 — Thermal Cracking** | <https://www.concreteanswers.org/CIPs/CIP42.htm> |
| Why the 35 °F limit is argued over — MnDOT relaxes it to 45 °F after 48 h and 60 °F after 7 days | *Mass Concrete Specifications: Two States' Perspectives*, Concrete Bridge Views | <https://concretebridgeviews.com/2016/03/mass-concrete-specifications-two-states-perspectives/> |

### Software

Backend, from `backend/pyproject.toml`: **FastAPI**, **uvicorn**, **pydantic** and
**pydantic-settings**, **numpy**, **scipy**, **requests**, **python-dotenv**; **pytest**,
**ruff**, **mypy**, **httpx** and **PyYAML** for development; built and run with
[**uv**](https://docs.astral.sh/uv/) and **hatchling**.

Frontend, from `frontend/package.json`: **Next.js 16** (App Router) on **React 19**,
**TypeScript**, **Tailwind CSS 4**, **three.js** via **@react-three/fiber** and
**@react-three/drei**, **web-ifc** for IFC import, **lucide-react**, **react-rnd**, and
**ESLint**. Scaffolded with stock `create-next-app`.

### Map tiles

The map view uses **Esri** basemaps — *Dark Gray Canvas*, *Light Gray Canvas* and *World
Imagery* — with no API key. **Attribution is a licence condition**, which is why it is drawn
on the map and why `frontend/src/lib/basemap.ts` refuses a custom tile source that does not
supply one. See [Pointing the map at your own tiles](#pointing-the-map-at-your-own-tiles).

## Credit

The FortyGuard API client in `backend/vendor/fortyguard/` is vendored unmodified from
[FortyGuard's temperature-api-quickstart](https://github.com/fortyguard), copyright
FortyGuard, Inc., MIT licensed. Their licence is kept alongside the code at
`backend/vendor/fortyguard/LICENSE`. Thanks to FortyGuard for the API and the quickstart.

SatAlite itself is MIT licensed — see `LICENSE`.
