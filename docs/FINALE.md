# SatAlite — FINALE

Everything needed to ship this: how to deploy it for nothing, what real-world sources
prove it works, what the competition looks like, what to say on camera, and what to check
before pressing submit.

Written 2026-08-27, re-measured against this commit the same day. Every number in
Section 0, Section 1 and Section 2.2 was **measured on this machine**, not estimated.
Where something was not measured, or could not be verified, it says so.

---

## Contents

- [Section 0 — Read this first](#section-0--read-this-first)
- [Section 1 — Deploying for free](#section-1--deploying-for-free)
- [Section 2 — Real sources and testable evidence](#section-2--real-sources-and-testable-evidence)
- [Section 3 — Competitor and prior-art map](#section-3--competitor-and-prior-art-map)
- [Section 4 — Demo video script and judge Q&A](#section-4--demo-video-script-and-judge-qa)
- [Section 5 — Known-weakness disclosure kit](#section-5--known-weakness-disclosure-kit)
- [Section 6 — Pre-submission checklist](#section-6--pre-submission-checklist)
- [Section 7 — Things found while writing this document](#section-7--things-found-while-writing-this-document)

---

# Section 0 — Read this first

Three facts that shape everything below.

**1. The product is CPU-bound, and that is the whole deployment problem.**
One deterministic solve of the shipped demo scenario is **6.14 s of wall time on one real
core** through `POST /api/simulate` (measured: four consecutive warm runs at 6.154, 6.135,
6.130 and 6.149 s; dt = 10 s, 25,920 steps, a 30 × 300 grid, 433 recorded frames). Peak
RSS of the uvicorn worker after those runs and one `?fields=true` run was **285 MiB**
(`VmHWM: 291,388 kB`). Everything else the app does — the season replay, the validation
report, the precomputed ensemble, the heatmap — is a **disk read that returns in under
11 ms**. So the hosting question is only ever "does this platform give me one real CPU
core for ten seconds", and the answer separates the free tiers cleanly.

Every timing in this document is that same measurement: wall time of the HTTP route on
one core of this machine, warm, not CPU-seconds and not an in-process call. Quoting one
method everywhere is the only way the free-tier arithmetic below stays honest.

**2. Most of the studio never touches the solver.** Measured response times on a warm
instance:

| Route | Status | Bytes | Time |
|---|---|---|---|
| `GET /api/health` | 200 | 33 | 0.8 ms |
| `GET /api/validation` | 200 | 7,553 | 1.9 ms |
| `GET /api/season-analysis` | 200 | 2,003 | 1.9 ms |
| `GET /api/demo-ensemble` | 200 | 170,232 | 10.5 ms |
| `GET /api/heatmap?lat=33.45&lon=-112.07&date=2025-07-15` | 200 | 46,144 | 5.3 ms |
| `GET /api/ambient/quote?...` | 200 | 91 | 0.7 ms |
| `POST /api/simulate` | 200 | 47,013 | **6.15 s** |
| `POST /api/simulate?fields=true&fields_stride_h=1.0` | 200 | **3,929,134** | **6.59 s** |
| `POST /api/pour-windows` (1 candidate) | 200 | 699 | 6.13 s |

That 3.93 MB figure matters later — see [1.4](#14-backend-path-b--vercel-python-functions-no-card).

An earlier draft of this table read 38,887 and 3,921,008 bytes on the two `simulate` rows.
Both grew by **exactly 8,126 bytes**, which is the `surface_probe_temp_c` array — 433
floats — that the surface-probe fix added to every payload. If you see the old numbers
quoted anywhere, they predate that commit.

**3. `POST /api/pour-windows` is N solves in one request.** `frontend/src/lib/scenario.ts`
sets `N_CANDIDATES = 6`, and `candidateOffsets()` returns up to six start hours. With the
shipped demo ambient (72 h span, 72 h duration) `room = 0`, so it degrades to a single
candidate and costs one solve. **Shorten the cure window in the left panel and it becomes
six solves ≈ 37 s in one HTTP request.** Any platform with a request timeout under ~60 s
will 504 on that. Note it before you demo a shortened duration.

---

# Section 1 — Deploying for free

## 1.1 The two paths, decided

| | Path A — Cloud Run | Path B — Vercel Python | Path C — Render Free |
|---|---|---|---|
| Credit card | **Required** (bill stays $0) | **Not required** | **Not required** |
| CPU | 1 real vCPU | 1 vCPU | **0.1 vCPU** |
| RAM | 1 GiB (set) | 2 GB | 512 MB |
| Solve time | **6.1 s** | ~6–10 s | **~60 s** |
| Request timeout | 120 s (you set it) | 300 s | proxy-limited |
| Cold start | 30–60 s (578 MB image) | ~5–15 s | 30–60 s |
| Live FortyGuard fetch | **Works** | **Breaks** (read-only FS) | Works |
| Repo changes needed | none | 1 file + 2 env vars | none (Docker) |
| Verdict | **Recommended** | **Best no-card option** | Fallback only |

Both A and B are documented in full below because you asked for both. If you have a card
and can spend five minutes setting a budget alert, **use Path A** — it is the only one
where a six-candidate pour-window sweep is comfortable and a live FortyGuard fetch works.

## 1.2 Frontend — Vercel (identical on all paths)

Nothing here is contentious; the only trap is build-time inlining.

1. Push the repo to GitHub (it already is: `MuazTPM-YT/satalite`).
2. Vercel → **Add New Project** → import the repo.
3. **Root Directory: `frontend`.** Vercel will otherwise look for a Next app at the repo
   root and fail.
4. Framework preset: Next.js (auto-detected). Build command `npm run build`, output
   handled by the preset. Leave both alone.
5. Environment variables — **Production, Preview and Development, all three**:

   ```
   NEXT_PUBLIC_API_URL   = https://<your-backend-origin>
   NEXT_PUBLIC_SITE_URL  = https://<your-vercel-domain>
   ```

6. Deploy.

**`NEXT_PUBLIC_*` is inlined at `next build`, not read at runtime.** `frontend/src/lib/api.ts`
reads `process.env.NEXT_PUBLIC_API_URL` at module scope with a `?? "http://localhost:8000"`
fallback. If you deploy the frontend before the backend exists, the built bundle will
contain `http://localhost:8000` forever and every judge will see a red status dot. Changing
the variable in the Vercel dashboard afterwards does **nothing** until you redeploy.

**Free-tier ceiling:** Vercel Hobby gives 100 GB bandwidth/month. `frontend/public/web-ifc.wasm`
is **1.3 MB** and ships to every visitor who touches the IFC import path; the rest of the
app is well inside a normal Next bundle. Not a real constraint for a hackathon.

**Hobby plan is non-commercial only.** A hackathon submission qualifies. If SatAlite later
becomes a commercial product, that plan does not follow it.

## 1.3 Backend path A — Google Cloud Run (recommended)

### Why this one

Cloud Run's **Always Free** tier is 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million
requests per month, applied as a spend-based discount at Tier 1 pricing and aggregated
per billing account, in Tier 1 regions (`us-central1`, `us-east1`, `us-west1`). At
6.14 vCPU-s per solve that is roughly **29,300 free solves a month**, on a real core
rather than a tenth of one. Memory is the looser constraint: at 1 GiB provisioned and
6.14 s per request, 360,000 GiB-s buys ~58,600 requests.

A realistic judge session — one page load (1 simulate with fields + 1 pour-windows) plus
some clicking — is on the order of 15–45 vCPU-seconds. You could serve **four thousand
judges** inside the free tier.

Billing must be enabled, so a card is on file. Set a budget alert at $1 and it will never
be touched.

### ⚠️ Why `gcloud run deploy --source .` cannot be used here

An earlier `README.md` said:

```bash
gcloud run deploy satalite-api --source . --region us-central1 ...
```

`--source` only auto-detects a Dockerfile **in the source root**. This repo's Dockerfile is
at `backend/Dockerfile` and its build context must be the repo root (because
`docs/VALIDATION.json` lives outside `backend/`). Cloud Build finds no root Dockerfile,
falls back to Google Cloud Buildpacks, finds no Python project at the root, and fails.

**The README has since been corrected** and now carries the explicit build/push pair below,
together with the reason. The two-step needs no repository change at all — it is simply the
only form that works with this layout.

### The commands that do work

```bash
# ── one-time setup ───────────────────────────────────────────────────────────
export PROJECT=your-gcp-project-id
export REGION=us-central1                # must be a Tier 1 region for the free tier

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com \
                       artifactregistry.googleapis.com \
                       cloudbuild.googleapis.com \
                       secretmanager.googleapis.com

gcloud artifacts repositories create satalite \
  --repository-format=docker --location="$REGION"

# the FortyGuard key never touches a command line that gets shelled out or logged
printf '%s' "$FORTYGUARD_API_KEY" | \
  gcloud secrets create fortyguard-key --data-file=-

# let Cloud Run's runtime service account read it
PROJNUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding fortyguard-key \
  --member="serviceAccount:${PROJNUM}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

# ── build and push (from the REPOSITORY ROOT) ────────────────────────────────
IMAGE="$REGION-docker.pkg.dev/$PROJECT/satalite/api:v1"
gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build -f backend/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"

# ── deploy ───────────────────────────────────────────────────────────────────
gcloud run deploy satalite-api \
  --image "$IMAGE" \
  --region "$REGION" \
  --memory 1Gi --cpu 1 \
  --concurrency 2 \
  --max-instances 4 --min-instances 0 \
  --timeout 120 \
  --allow-unauthenticated \
  --set-env-vars "ALLOWED_ORIGINS=https://your-frontend.vercel.app" \
  --set-secrets "FORTYGUARD_API_KEY=fortyguard-key:latest"
```

No Docker locally? Replace the build/push pair with Cloud Build, which accepts an explicit
Dockerfile path:

```bash
gcloud builds submit --config=- . <<'YAML'
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-f', 'backend/Dockerfile', '-t', '$_IMAGE', '.']
images: ['$_IMAGE']
YAML
# pass --substitutions=_IMAGE="$IMAGE"
```

### Why each flag is what it is

- **`--concurrency 2`** — the solve is CPU-bound, single-threaded numpy. Cloud Run's
  default of 80 would queue eighty 6.1-second solves on one vCPU and time every one of them
  out. Two is enough to overlap a disk-read route behind a solve without starving it.
- **`--cpu 1`** — Cloud Run's fractional CPU options would turn 6.14 s into 12 s or 25 s.
- **`--memory 1Gi`** — measured peak RSS is 285 MiB (`VmHWM: 291,388 kB`). 512Mi leaves
  under 230 MiB of headroom, and the ensemble path (`?ensemble=true&samples=2000`)
  allocates far more; OOM on Cloud Run is an instant 500 with a useless log line. 1 GiB
  costs GiB-seconds, not dollars, inside the free tier.
- **`--max-instances 4`** — a cap on the worst case if the link is shared publicly.
- **`--min-instances 0`** — this is what keeps it free. It is also what creates the cold
  start; see the [warm-up drill](#19-the-pre-demo-warm-up-drill).
- **`--timeout 120`** — comfortably above a six-candidate sweep at ~37 s.

### Cold start

The image is **578 MB** (measured in the Dockerfile comments: 970 MB single-stage, 672 MB
with the uv cache dropped, 578 MB as it stands; scipy alone is 152 MB and numpy 67 MB of
the 260 MB venv). That is what a scale-to-zero host pulls on a cold start. Expect 30–60 s
for the first request after idle. This is survivable and entirely fixable with one `curl`.

## 1.4 Backend path B — Vercel Python Functions (no card)

This is the best genuinely card-free option, and it is close to zero-config because the
repo already happens to match Vercel's conventions.

### What already lines up

- Vercel's Python runtime looks for an entrypoint at `app.py`, `index.py`, `server.py`,
  `main.py`, `wsgi.py` or `asgi.py`, **including inside `app/`**. This repo has
  `backend/app/main.py` with a top-level `app = create_app()`. Exact match.
- Dependencies are read from `pyproject.toml` **with or without a `uv.lock`**. Both are in
  `backend/`.
- Python **3.12** is Vercel's default and `pyproject.toml` pins `requires-python = "==3.12.*"`.
- Bundle limit for the Python runtime is **500 MB uncompressed** (not the 250 MB that
  applies to Node). The production venv is ~260 MB. Comfortable.
- Max duration on **Hobby is 300 s**, default and maximum, with Fluid Compute on by
  default. A 37 s six-candidate sweep fits with room to spare.
- Memory/CPU on Hobby: **2 GB / 1 vCPU**. Measured peak RSS 285 MiB. Fine.

All six checked against Vercel's own docs on 2026-08-27.

### What does not line up, and what to do about it

**(a) `docs/VALIDATION.json` lives outside `backend/`.** With Vercel's Root Directory set
to `backend`, that file is not in the bundle and `GET /api/validation` will 503 with
*"VALIDATION.json has not been built yet."*

Two ways out, neither of which touches Python source:

- Deploy with Root Directory `backend` and **copy** `docs/VALIDATION.json` to
  `backend/docs/VALIDATION.json`, then set `VALIDATION_PATH` to the absolute path Vercel
  gives you. Simple, but it duplicates a generated file.
- Or set Root Directory to the repository root and add a `pyproject.toml` at the root
  carrying `[tool.vercel] entrypoint = "backend.app.main:app"`. Cleaner conceptually, more
  moving parts.

**(b) The filesystem is read-only except `/tmp`.** `app/services/cache.py::cached_call`
does `cache_dir.mkdir(...)` and `tmp.write_text(...)` on a cache **miss**. The write happens
**after** the FortyGuard call returns. So on Vercel a live fetch would **spend 4,220 credits
and then crash with a read-only-filesystem error**, returning a 500 and keeping nothing.

> **⚠️ On Vercel, never send `allow_live: true`.** The credits are gone and the answer is
> lost. `GET /api/heatmap` and `GET /api/ambient/quote` never spend and are safe; so is
> `POST /api/ambient` without `allow_live`, which refuses and names the price. The shipped
> Phoenix 2025-07-15 day is in the bundle and reads fine.
>
> `get_settings()` also calls `settings.cache_dir.mkdir(parents=True, exist_ok=True)` at
> **startup**. `exist_ok=True` on a directory that already exists performs no write, and
> `backend/data/cache/` **is committed** (`.gitkeep`, `demo-ensemble.json`,
> `season-analysis.json`, and the Phoenix heatmap are all tracked), so startup succeeds.
> If you point `CACHE_DIR` at a path that does *not* exist in the bundle, the app will
> fail to boot.

**(c) The 4.5 MB request/response body cap.** A Vercel Function's request or response body
is capped at **4.5 MB**; over it you get `413 FUNCTION_PAYLOAD_TOO_LARGE`. The studio's
first paint calls `simulate(request, { fields: true, fields_stride_h: 1.0 })`, and that
response measured **3,929,134 bytes** for the shipped demo element (a 3000 × 300 mm slab at
dx = 10 mm → 300 × 30 cells × 73 kept frames, rounded to 2 dp).

**That is 3.93 MB against a 4.5 MB ceiling — 13% headroom.** Both figures are decimal MB,
which is how Vercel states the cap; quoting the payload as "3.74 MB" reads it as MiB
against a decimal ceiling and flatters the margin by four points. It passes today. It will
not pass for a bigger section. Roughly: payload scales with `width × thickness / dx²` and
with `duration / stride`. A 6 m slab, or the same slab at dx = 7 mm, or a 168 h run, blows
through it. Gzip does not save you — the same response gzips to 41,635 bytes, but the cap
is on the uncompressed body.

Vercel's **Large Functions** beta lifts the *bundle* limit to 5 GB on the Python runtime.
It does nothing for this: the bundle is ~260 MB and comfortable, and the 4.5 MB body cap is
a separate limit that Large Functions does not move.

Mitigation without touching code: raise `fields_stride_h` (the frontend constant is
`FIELD_STRIDE_H = 1.0` in `frontend/src/lib/scenario.ts`) or keep `dx_m` at 0.01+ for demo
elements. Know the number; do not discover it live.

### The one file to add

```json
// vercel.json  (at whatever you set as Root Directory)
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/main.py": {
      "maxDuration": 300,
      "excludeFiles": "{tests/**,validation/**,scripts/**,results/**,.venv/**,.mypy_cache/**,.ruff_cache/**,.pytest_cache/**}"
    }
  }
}
```

`excludeFiles` matters: `backend/results/` alone is a dozen JSON artifacts, and
`.venv/` would double the bundle if it were ever committed.

Environment variables in the Vercel project:

```
FORTYGUARD_API_KEY = <key>
ALLOWED_ORIGINS    = https://your-frontend.vercel.app
CACHE_DIR          = <absolute path to the bundled backend/data/cache>
VALIDATION_PATH    = <absolute path to the bundled VALIDATION.json>
```

`app/config.py` anchors any **relative** `CACHE_DIR`/`VALIDATION_PATH` to `_REPO_ROOT`,
which it derives as `Path(__file__).resolve().parents[2]`. Under Vercel's flattened layout
that walk lands somewhere unhelpful — exactly the same failure mode the Dockerfile already
works around with `ENV CACHE_DIR=/app/data/cache VALIDATION_PATH=/app/docs/VALIDATION.json`.
**Name both absolutely.** Deploy once, read the path out of a boot log
(`satalite 0.1.0 starting, cache_dir=... origins=...` is logged by `create_app`), then set
them and redeploy.

### Honest assessment of Path B

It works, it costs nothing, it needs no card, and it puts frontend and backend on one
platform with one dashboard. It costs you the live-fetch capability and it leaves you 17%
under a hard response-size cap. For a demo that runs on the shipped Phoenix day — which is
the only free day anyway — that is a fair trade.

## 1.5 Backend path C — Render free (no card, degraded)

Render's free web service is **512 MB RAM and 0.1 CPU**, 750 instance-hours/month per
workspace, 100 GB bandwidth, 500 build minutes, spinning down after 15 minutes of
inactivity with a 30–60 s restart. No credit card needed.

Memory just fits — 285 MiB peak measured against 512 MB, so under half the box is free and
an ensemble run would not have room. **CPU is the disqualifier.** 0.1 vCPU is a hard cgroup
quota, so the measured 6.14 s solve becomes roughly **61 s**, and a six-candidate sweep
roughly **six minutes**. Both will be perceived as broken.

What still works perfectly on Render: `/api/health`, `/api/validation`,
`/api/season-analysis`, `/api/demo-ensemble`, `/api/heatmap`, `/api/ambient/quote` — every
one of them a sub-6-ms disk read, and collectively most of the studio's surface area. The
season replay panel, the validation panel, the ensemble band and the whole map view would
be indistinguishable from Cloud Run.

So Render is a legitimate **fallback link** — "if the main backend is cold, this one serves
everything except a live solve" — and a bad primary.

Setup: **New → Web Service → Docker**, Dockerfile Path `backend/Dockerfile`, Docker Build
Context Directory `.` (the repo root — this is the flag most people miss), environment
`FORTYGUARD_API_KEY` and `ALLOWED_ORIGINS`. `PORT` is injected by Render and the
Dockerfile's `CMD` already honours it.

## 1.6 What was ruled out, and the evidence

Every row re-checked against the platform's own docs or announcement on **2026-08-27**.

| Platform | Status as of August 2026 | Why not |
|---|---|---|
| **Hugging Face Spaces** | Docker SDK is marked **Paid** | Free CPU Basic was withdrawn in July 2026; Docker and Gradio SDKs now require PRO for personal accounts, Team or Enterprise for organisations. Static Spaces remain free, which does not help a Python solver. |
| **Fly.io** | No free tier for new users | Legacy accounts keep 3 shared-CPU 256 MB VMs; new sign-ups get none, and a card is required. 256 MB would not hold a 285 MiB peak anyway. |
| **Koyeb** | Free Starter tier **closed to new users** | [Mistral AI acquired Koyeb in February 2026](https://techcrunch.com/2026/02/17/mistral-ai-buys-koyeb-in-first-acquisition-to-back-its-cloud-ambitions/); new sign-ups get Pro and above only. Existing customers keep their tier. |
| **Oracle Cloud Always Free** | Alive but **halved** | Ampere A1 allowance cut from 4 OCPU/24 GB to **2 OCPU/12 GB** (1,500 OCPU-hours, 9,000 GB-hours a month) effective 15 June 2026, enforced from **18 August 2026** with over-entitlement instances terminated, and [no public announcement](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/). Still the most raw free compute available, still ARM (the `python:3.12-slim` base and numpy/scipy all have aarch64 wheels, so the image builds), still requires a card and notoriously scarce capacity. Viable if you already have an instance; not something to attempt three days out. |
| **Railway** | $5 first month, then $1/month credit | Services pause when credits run out. A 578 MB image with any traffic will exhaust $1 quickly. |
| **Cloudflare Workers** | 10 ms CPU per invocation | Off by three orders of magnitude. |
| **PythonAnywhere free** | WSGI only, restricted outbound | FastAPI is ASGI. |

## 1.7 Order of operations (get this wrong and you will chase a ghost for an hour)

There is a genuine circular dependency: the frontend needs the backend origin at build
time, and the backend needs the frontend origin in `ALLOWED_ORIGINS`.

1. **Deploy the backend first**, with `ALLOWED_ORIGINS` set to a placeholder or to
   `http://localhost:3000`. Note the URL it gives you.
2. **Build the frontend** with `NEXT_PUBLIC_API_URL` = that backend URL. Note the Vercel
   URL it gives you.
3. **Redeploy/update the backend** with `ALLOWED_ORIGINS` = the real Vercel origin.
   On Cloud Run: `gcloud run services update satalite-api --region "$REGION"
   --set-env-vars "ALLOWED_ORIGINS=https://satalite.vercel.app"` — no rebuild needed.
4. **Hard-refresh** and confirm the status dot in the command bar is green.

`ALLOWED_ORIGINS` is a comma-separated **string**, deliberately not a list — pydantic-settings
2.6 JSON-decodes list fields straight out of the environment and would raise before any
validator ran. Write `https://a.vercel.app,https://b.vercel.app`, no JSON, no spaces needed.

Include **every** origin judges might land on: the production domain, and the
`*-git-main-*.vercel.app` preview domain if you ever send a preview link. A missing origin
produces a browser CORS block that looks *identical* to a dead backend — which is precisely
why `frontend/src/components/HealthProbe.tsx` surfaces the failure reason verbatim in the
status-dot tooltip. Hover it before you panic.

## 1.8 The API key, and who gets to spend credits

You said the judges will probably supply their own key. Both audiences are covered:

**For a judge running it themselves.** `.env.example` and `frontend/.env.local.example` are
both committed and both explain themselves. The backend **refuses to start** without
`FORTYGUARD_API_KEY` — a deliberate loud failure at startup instead of a confusing 401 on
the first request. `README.md` § Setup is already the right instructions. Nothing to do.

**For your public deployment.** Your key sits in the backend. Anyone with the URL can, in
principle, POST `/api/ambient` with `allow_live: true` and burn **4,220 credits per
site-day** out of a ~2,000,000 credit budget — about 474 heatmap calls total, ever. The
safeguards already in the code:

- `GET /api/ambient/quote` never calls FortyGuard, so the picker can price every keystroke
  for nothing.
- `POST /api/ambient` **refuses** an uncached day unless `allow_live: true` is explicitly
  set, and the refusal names the price.
- `GET /api/heatmap` **cannot spend at all** — a day not on disk is a 409 with the price
  and a pointer to the location control.
- The UI requires a second, explicit click on a button carrying the credit number, and any
  input change disarms it.
- AOI centres are snapped to a grid one AOI wide (`snap_to_aoi`), so nudging a pin twenty
  metres does not re-buy the day.

What is **not** there is a server-side rate limit. Practical options, in ascending effort:

- **Deploy on Vercel (Path B).** The read-only filesystem makes a successful live fetch
  impossible. Crude, effective, free.
- **Deploy with a spent or scoped key.** If FortyGuard issues a read-limited or exhausted
  key, the live path 401s harmlessly and every cached route still works.
- **Cloud Run `--max-instances 4`** caps concurrency, not spend. It is not a credit control.
- **Watch the meter.** Check your FortyGuard dashboard before and after judging.

For a two-day judging window on a link you control, the two-click confirmation plus a
watched meter is proportionate. Do not post the URL somewhere public and walk away.

## 1.9 The pre-demo warm-up drill

`--min-instances 0` is what makes Cloud Run free, and it is also a 30–60 s cold start on a
578 MB image. Run this **five minutes before** you record or present:

```bash
API=https://satalite-api-xxxxx.run.app

# 1. wake the instance and confirm it is the build you think it is
curl -s "$API/api/health"          # -> {"status":"ok","version":"0.1.0"}

# 2. warm the disk-read routes (these are what the panels paint from)
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "$API/api/validation"
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "$API/api/season-analysis"
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "$API/api/demo-ensemble"
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' \
  "$API/api/heatmap?lat=33.45&lon=-112.07&date=2025-07-15"

# 3. force numpy/scipy to import and the JIT-free hot loop to touch memory,
#    by running one real solve through the real route
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' \
  -X POST "$API/api/simulate" -H 'Content-Type: application/json' \
  -d "$(curl -s "$API/api/demo-ensemble" | python3 -c 'import sys,json;print(json.dumps(json.load(sys.stdin)["scenario"]))')"

# 4. confirm CORS from the real frontend origin, which is the failure
#    that looks like a dead backend
curl -s -D- -o /dev/null -X OPTIONS "$API/api/simulate" \
  -H "Origin: https://your-frontend.vercel.app" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control
```

Step 4 is the one people skip and the one that ruins demos.

**If the backend dies mid-judging:** the frontend degrades honestly rather than blanking —
`GET /api/season-analysis` returns `available: false` at **200** with a `detail` string, by
design, because a season costs real money and an image can legitimately ship without one.
Every other precomputed route 503s with the command that builds it. Have the Render
fallback URL ready in a second browser tab and rebuild the frontend against it in ~90 s if
you truly must.

---

# Section 2 — Real sources and testable evidence

This section is the one to mine for the demo. It has four kinds of thing:

1. **Ground-truth datasets** you can run through SatAlite and compare numbers against.
2. **A free hourly weather source** that makes those datasets runnable at all.
3. **Standards and papers** every constant traces to.
4. **Footage and threads** of practising engineers describing the exact problem.

## 2.1 The primary dataset (already wired into the repo)

**USBR DSO-12-02** — *Thermal Properties of Reinforced Structural Mass Concrete*,
Katie Bartojay, US Bureau of Reclamation, 2012. **Public domain.**

📄 <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-12-02.pdf>

Already transcribed into `backend/validation/cases/*.yaml`, already run by
`pytest validation/ -m validation`, already reported in `docs/VALIDATION.md` and served at
`GET /api/validation`. Full input/expected tables are in `docs/VALIDATION-CASES.md`.

**Current standing, from `docs/VALIDATION.json`, 300 samples per case:**

| Case | Kind | Coverage | Peak band width | Median peak error |
|---|---|---|---|---|
| `deer_creek_adiabatic` | adiabatic | **100%** (1/1) | 23.5 °C | +5.9% on rise |
| `deer_creek_p4_2008` | field | 40% (2/5) | 25.6 °C ⚠️ | +0.10 °C |
| `stony_gorge_2008` | field | 40% (2/5) | 21.8 °C | −7.89 °C |

**The single most quotable sentence in this entire body of literature**, from Table 9 of
that report — same mix cured three ways, one of them a chamber programmed to replay the
actual field temperature curve:

> *"The average 3-day compressive strength for the in-situ cured concrete is comparable to
> the average fog-cured 28-day compressive strength."*

Three days versus twenty-eight, from a US federal report. And the numbers behind it: at
24 h the in-situ-cured concrete is **77% stronger** than the fog-cured cylinder (5,170 vs
2,920 psi); by 90 d it is **15% weaker** (6,313 vs 7,450 psi). That second half is the
crossover effect, measured — and it is why SatAlite explicitly does not claim to be a
28-day strength predictor.

## 2.2 ⭐ A second, independent dataset — and SatAlite's actual results on it

This is new. It was found, transcribed, and **run against this commit** while writing this
document, and it is the strongest single piece of evidence you have.

**Source:** Gross, E. D., Eiland, A. D., Schindler, A. K. & Barnes, R. W. (**December
2017**), *Temperature Control Requirements for the Construction of Mass Concrete Members*,
Auburn University Highway Research Center, ALDOT Research Report **930-860R**. Publicly
downloadable.

📄 <https://eng.auburn.edu/files/centers/hrc/930-860r-temperature-control.pdf>
📄 Mirror: <https://rosap.ntl.bts.gov/view/dot/42366>

Every input and expected-output figure in §2.2.1 and §2.2.2 below was checked line by line
against the report's own Tables 5-1 through 5-20, Table 5-23, Tables 6-1 and 6-2, and
Appendix Tables B-1 through H-1 on 2026-08-27. Where the report contradicts itself, this
document says so rather than picking silently.

**What it contains that matters:** seven real Alabama DOT mass-concrete elements,
instrumented with iButton sensors (precise to ±1.8 °F below 158 °F), with (a) complete mix
proportions in the appendices, (b) placement date/time/temperature and formwork type, (c)
measured maximum concrete temperature and maximum temperature difference with the hour each
occurred, **and** (d) a published accuracy assessment of **ConcreteWorks** — the
TxDOT-funded, DOT-standard thermal prediction tool — on those same seven elements.

That last item is the gift. It gives you a **published error bar for the industry-standard
tool on the same data**, so your own error is not a number floating in space.

### 2.2.1 The inputs (ready to type into the studio)

Converted to SI. `pcy` = lb/yd³ → kg/m³ at ×0.5933. The third dimension is the member's
length; SatAlite solves the cross-section, which is correct for prismatic elements.

| Element | Section (ft) | Section (mm) | SatAlite shape | Cementitious kg/m³ | w/cm | Fly ash | Formwork | T_place °C |
|---|---|---|---|---|---|---|---|---|
| Albertville Bent Cap | 6.5 × 6.5 | 1981 × 1981 | `rect_column` | 336.4 | 0.494 | 25% Class F | wood | 29.4 |
| Harpersville Crashwall | 4 × 10 | 1219 × 3048 | `wall` | 317.4 | 0.499 | 21% Class C ¹ | wood | 29.4 |
| Scottsboro Pedestal | 10 × 12.5 | 3048 × 3810 | `rect_column` | 367.8 | 0.476 | 20% Class F | **steel** | 35.0 |
| Scottsboro Bent Cap | 6.5 × 7.5 | 1981 × 2286 | `rect_column` | 367.8 | 0.476 | 20% Class F | wood | 35.0 |
| Elba Bent Cap | 5 × 5.5 | 1524 × 1676 | `rect_column` | 326.3 | 0.500 | 20% Class F | wood | 22.2 |
| Birmingham Column | 4.5 × 4.5 | 1372 × 1372 | `rect_column` | 356.0 | 0.450 | 20% Class C | wood | 16.1 |
| Brewton Bent Cap | 6.0 × 6.5 | 1829 × 1981 | `rect_column` | 316.8 | 0.500 | 20% Class F ² | wood | 23.3 |

¹ The report's Table 5-4 says 20%. 110 of 535 pcy is 20.6%, so `fly_ash_frac = 0.206` was
used and is rounded to 21% here. The 0.6% is worth nothing; the point is to say which.

² **The report contradicts itself on Brewton.** Table 5-20 says Class **F** fly ash and
Gravel coarse aggregate; Appendix Table H-1, which is the mix ticket, says Class **C** fly
ash (107 pcy) and #67 **Limestone**. The runs below took Table 5-20's Class F and Appendix
H-1's limestone, which is the inconsistent pair. Class C would raise `p_fa_cao` in both
`ultimate_heat_j_per_kg` and the `exp(9.50 · p_fa · p_fa_cao)` term of `tau_hours`, so this
is not cosmetic — it is the one element of the seven whose ash class is genuinely unknown.
It is also the element with the best ConcreteWorks agreement, so do not lean on it.

Raw mix proportions, straight from the report's appendices — verified against Appendix
Tables B-1 through H-1 (lb/yd³):

| Element | Type I/II cement | Fly ash | Water | Coarse agg | Sand |
|---|---|---|---|---|---|
| Albertville | 427 | 140 (F) | 280 | 1900 limestone | 1169 |
| Harpersville | 425 | 110 (C) | 267 | 1825 limestone | 1319 |
| Scottsboro Pedestal | 496 | 124 (F) | 295 | 1870 limestone | 1111 |
| Scottsboro Bent Cap | 496 | 124 (F) | 295 | 1870 limestone | 1111 |
| Elba | 440 | 110 (F) | 275 | 1850 river gravel | 1250 |
| Birmingham | 480 | 120 (C) | 270 | 1910 limestone | 1209 |
| Brewton | 427 | 107 (C per H-1, F per 5-20) | 267 | 1852 limestone | 1196 |

Placement date/time: Albertville 2015-07-31 06:00 · Harpersville 2015-08-24 10:20 ·
Scottsboro Pedestal 2015-09-03 10:20 · Scottsboro Bent Cap 2015-09-18 11:00 ·
Elba 2015-12-18 11:00 · Birmingham 2016-01-21 09:55 · Brewton 2016-07-15 06:00.

### 2.2.2 The expected outputs (Table 5-23 of the report)

| Element | Max concrete temp | at hour | Max ΔT | at hour |
|---|---|---|---|---|
| Albertville Bent Cap | 168 °F / **75.6 °C** | 20 | 40 °F / **22.2 °C** | 92 |
| Harpersville Crashwall | 168 °F / **75.6 °C** | 27 | 42 °F / **23.3 °C** | 44 |
| Scottsboro Pedestal | 185 °F / **85.0 °C** | 45 | 68 °F / **37.8 °C** | 93 |
| Scottsboro Bent Cap | 167 °F / **75.0 °C** | 27 | 50 °F / **27.8 °C** | 42 |
| Elba Bent Cap | 127 °F / **52.8 °C** | 18 | 21 °F / **11.7 °C** | 22 |
| Birmingham Column | 111 °F / **43.9 °C** | 30 | 19 °F / **10.6 °C** | 42 |
| Brewton Bent Cap | 154 °F / **67.8 °C** | 27 | 38 °F / **21.1 °C** | 26 |

And the report's own accuracy bands (Table 6-1), which are the fairest yardstick because
they are somebody else's, set before anyone knew your answer:

| Class | Max temperature | Max temperature difference |
|---|---|---|
| Excellent | ±0–5 °F (±2.8 °C) | ±0–3 °F (±1.7 °C) |
| Good | ±5–10 °F (2.8–5.6 °C) | ±3–6 °F (1.7–3.3 °C) |
| Acceptable | ±10–15 °F (5.6–8.3 °C) | ±6–9 °F (3.3–5.0 °C) |
| Poor | ≥15 °F (≥8.3 °C) | ≥9 °F (≥5.0 °C) |

### 2.2.3 ⭐ What SatAlite actually produced

All seven run through `POST /api/simulate` against this commit. `dx_m = 0.02`,
`duration_hours = 168`, `cement_type = "I"`, `grade = "4000psi"`, hourly ambient pulled from
the free Open-Meteo archive at each town's coordinates for each placement date (see
[2.3](#23-the-free-hourly-weather-source-that-makes-those-cases-runnable)). Wall time
10–35 s per case.

| Element | Measured peak | **SatAlite** | SatAlite error | Class | ConcreteWorks error | Class |
|---|---|---|---|---|---|---|
| Albertville Bent Cap | 75.6 °C | 71.8 °C | **−3.8 °C** | Good | −5.0 °C | Good |
| Harpersville Crashwall | 75.6 °C | 67.8 °C | **−7.8 °C** | Acceptable | −6.7 °C | Acceptable |
| Scottsboro Pedestal | 85.0 °C | 86.9 °C | **+1.9 °C** | **Excellent** | −7.2 °C | Acceptable |
| Scottsboro Bent Cap | 75.0 °C | 84.5 °C | **+9.5 °C** | Poor | −2.8 °C | **Excellent** |
| Elba Bent Cap | 52.8 °C | 57.5 °C | **+4.7 °C** | Good | +5.0 °C | Good |
| Birmingham Column | 43.9 °C | 49.9 °C | **+6.0 °C** | Acceptable | +6.1 °C | Acceptable |
| Brewton Bent Cap | 67.8 °C | 63.7 °C | **−4.1 °C** | Good | +1.7 °C | **Excellent** |

Classes are Table 6-1's own bands applied to each row: Excellent ±0–5 °F, Good ±5–10 °F,
Acceptable ±10–15 °F, Poor ≥15 °F. The report's ConcreteWorks column reads −9, −12, −13,
−5, +9, +11 and +3 °F, and its prose says two of those were Excellent — the −5 and the +3,
which is Scottsboro Bent Cap and Brewton. An earlier draft of this table marked Scottsboro
Bent Cap "Good"; it is Excellent, and correcting it makes the benchmark look better than we
were printing it.

**Mean absolute error on peak core temperature:**

- **SatAlite: 5.40 °C** (worst case 9.5 °C)
- **ConcreteWorks: 4.93 °C** (worst case 7.2 °C — 62 °F over seven rows, ÷ 7 = 8.857 °F)

**Half a degree apart, across seven real placements spanning July heat to January cold, a
40 °C range of measured peaks, four member types and two aggregate types.** SatAlite is
beaten, and beaten narrowly, by a tool with two decades of DOT funding behind it — while
using only free public weather and no lab calibration of any kind.

That is the honest headline, and it is far more persuasive than a claim of superiority
would be.

Two more results from the same run, both of which you should state rather than let a judge
find:

**Time to peak is systematically late.** Errors: +14.7, +2.3, +8.2, +6.0, +12.0, +3.2,
+14.2 hours. **Mean +8.7 h, and every single one positive** — a bias, not scatter. The
project's own acceptance criterion is ±8 h, so four of seven miss it. This matches the
existing finding in `docs/LIMITATIONS.md` §8 that both USBR field cases run badly cold at
12 h and 24 h before crossing to warm later: the early-age curve rises too slowly.

**The core–surface differential reads far too high**, by +15.3 to +35.7 °C:

| Element | Measured max ΔT | SatAlite max ΔT | Error |
|---|---|---|---|
| Albertville | 22.2 °C | 48.2 °C | +26.0 |
| Harpersville | 23.3 °C | 47.7 °C | +24.4 |
| Scottsboro Pedestal | 37.8 °C | 61.7 °C | +23.9 |
| Scottsboro Bent Cap | 27.8 °C | 58.9 °C | +31.1 |
| Elba | 11.7 °C | 46.3 °C | +34.6 |
| Birmingham | 10.6 °C | 46.3 °C | +35.7 |
| Brewton | 21.1 °C | 36.4 °C | +15.3 |

**Part of this was a definition mismatch. It has since been fixed, and the fix accounts
for about a fifth of the gap.** `physics/solver.py` built `surface_temp_c` as the mean over
*every* free-surface cell of the reconstructed **true free surface** temperature, and
compared that against ACI 301's 35 °F (19.4 °C) limit — which is written against a
thermocouple cast a few inches under a face. Auburn's sensor sits 1 inch in; USBR's sits
6 inches in. The free face at 4 a.m. is far colder than either.

The solver now also reports `surface_probe_temp_c` at `ElementSpec.surface_probe_depth_m`
(default 0.050 m, configurable because the depth is spec-dependent), with
`max_core_probe_diff_c` / `max_anywhere_probe_diff_c`, **and the cracking flag is evaluated
on those.** Sweeping the depth on four of the elements above shows exactly what that buys:

| Element | measured | free surface | 25 mm | 50 mm | 100 mm | 150 mm |
|---|---|---|---|---|---|---|
| Birmingham column | 10.6 | 46.3 | 42.9 | 40.7 | 34.7 | 29.5 |
| Elba bent cap | 11.7 | 46.3 | 43.2 | 41.2 | 35.9 | 31.1 |
| Albertville bent cap | 22.2 | 48.2 | 45.4 | 43.6 | 38.7 | 34.2 |
| Scottsboro pedestal | 37.8 | 61.7 | 59.0 | 57.5 | 53.1 | 49.6 |

**About 5 °C at 50 mm, about 17 °C even at 150 mm — against a gap of 24 to 36 °C.** So the
measuring point was genuinely wrong and is now right, and the over-reading is still there.
Since peak core temperature on the same runs is roughly right (5.40 °C MAE), the core is
not the problem: **the modelled surface runs far too cold**, which points at the boundary
and points the same way as the late-peak bias. That is undiagnosed and unfixed, and it is
written up as `docs/LIMITATIONS.md` §10.

Where the fix bites hard is thin sections, because the sensor depth is a fraction of the
half-thickness. On a 2 m bent cap 50 mm is a twentieth of it — hence the small movements in
the table above. On the studio's own default element, a 300 mm slab, it is a third: the
probe differential is **15.40 °C against 29.03 °C at the free surface**, so the nominal
probe now sits *under* the 19.4 °C limit and only the hottest-point differential (20.22 °C)
trips it.

**And that rewrites the season headline.** `season-analysis.json` is built on that same
300 mm slab. Rebuilding it after the flag moved:

| | free surface | surface sensor |
|---|---|---|
| cracking breach at 04:00 | 100% | **0%** |
| cracking breach at 14:00 | 100% | **50%** |
| Δ (14:00 − 04:00) | 0 | **50** |

A number that read 100% at both hours told a judge nothing. Against the sensor the same
30 days separate the two placement hours completely — which is the entire claim the season
replay exists to make, and it was invisible while the flag saturated. Nothing about the
weather, the element or the solver changed; only the point the limit is read at.

### 2.2.4 Reproducing it — the exact recipe

The runner script is not in the repo. The repo itself has changed since these runs — the
surface-probe fix landed, `H_CEM_BY_TYPE` gained `"I/II"`, and the README's Cloud Run
command was corrected — but none of those moves the seven peak temperatures below, which
depend on the core, not on the surface probe, and were run with `"I"` rather than `"I/II"`.
Rebuild the runner in about twenty lines:

```python
import json, urllib.request, urllib.parse, subprocess, datetime

LAT, LON, DATE, START_H = 34.2676, -86.2088, "2015-07-31", 6   # Albertville, 06:00
q = urllib.parse.urlencode({
    "latitude": LAT, "longitude": LON,
    "start_date": DATE,
    "end_date": (datetime.date.fromisoformat(DATE) + datetime.timedelta(days=9)).isoformat(),
    "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,shortwave_radiation",
    "timezone": "America/Chicago",
})
h = json.load(urllib.request.urlopen(
    "https://archive-api.open-meteo.com/v1/archive?" + q))["hourly"]

n, i0 = 169, START_H
sl = lambda k: [float(x) for x in h[k][i0:i0 + n]]
ambient = {
    "hours_h":   [float(i) for i in range(n)],
    "air_temp_c": sl("temperature_2m"),
    "rh_frac":   [x / 100 for x in sl("relative_humidity_2m")],   # % -> fraction
    "wind_ms":   [x / 3.6 for x in sl("wind_speed_10m")],          # km/h -> m/s
    "cloud_pct":  sl("cloud_cover"),                                # already percent
    "ghi_w_m2":   sl("shortwave_radiation"),                        # already W/m2
}
req = {
    "element": {"shape": "rect_column", "dims_mm": {"width": 1981.0, "height": 1981.0},
                "dx_m": 0.02, "placement_temp_c": 29.4,
                "formwork": "plywood_18mm", "on_ground": False},
    "mix": {"mix_id": "albertville", "cement_type": "I", "cementitious_kg_m3": 336.4,
            "w_cm": 0.494, "fly_ash_frac": 0.247, "grade": "4000psi"},
    "ambient": ambient, "duration_hours": 168.0,
}
open("alb.json", "w").write(json.dumps(req))
# curl -s -X POST localhost:8000/api/simulate -H 'Content-Type: application/json' -d @alb.json
```

Three gotchas that cost time the first run:

1. **`cement_type: "I/II"` used to be a 422, and no longer is.** Every Auburn element is
   Type **I/II**, and when these runs were made `H_CEM_BY_TYPE` carried only `I` = 510,
   `II` = 500, `II/V` = 470 and `V` = 450 J/g, so the designation had to be relabelled
   before the mix would solve at all. `physics/constants.py` now carries
   **`"I/II": 505.0`**, placed between `I` and `II` the way `II/V` sits between its two,
   with the competing argument written into the constant's own comment.

   **The runs above predate that and used `"I"` (510 J/g).** The difference is 1% on
   `H_cem`, which the constant's comment puts at about 0.1 °C on peak core — inside the
   width the ensemble samples. For reference `"II"` (500 J/g) moves peak by roughly
   **−0.9 °C**, measured on Albertville: 71.8 °C vs 70.9 °C. Rerun with `"I/II"` if you
   redo this; either way, state which you used.
2. **`fly_ash_frac` is a FRACTION 0–1**, not the percentage the studio input box shows.
3. **Unit conversions are yours to do.** Open-Meteo gives RH in %, wind in km/h. The
   backend wants `rh_frac` 0–1 and `wind_ms` in m/s and *rejects* percentages. It wants
   `cloud_pct` in percent 0–100 and GHI in W/m², both of which Open-Meteo already supplies.

### 2.2.5 Why these seven cases matter more than the three you have

- **They are independent.** `docs/LIMITATIONS.md` §1 records that `H_CEM_DEFAULT` was moved
  from 470 to 500 J/g against Stony Gorge, which is *also* a validation case. No constant in
  the codebase has ever seen an Alabama bent cap. Nothing here is tuned.
- **They are 7 elements, not 3**, spanning summer and winter placements and a 40 °C range of
  measured peaks — Birmingham at 43.9 °C in January, Scottsboro Pedestal at 85.0 °C in
  September.
- **They come with a benchmark.** ConcreteWorks' error on the identical elements is
  published by the same authors in the same table. You are not asking a judge to decide
  whether 5.4 °C is good; you are showing that the DOT-standard tool scores 4.9 °C on the
  same seven rows.
- **They are US placements**, which is FortyGuard's coverage area — though **2015–2016 is
  outside the FortyGuard archive, which starts 2021-01-01**. That is why the runs above used
  Open-Meteo. Be upfront: this validates the *physics*, not the hyperlocal data path.

### 2.2.6 ⭐ What the report also publishes, and nothing here can use

This is the largest single opportunity in the dataset, and it was missed on the first pass
through the PDF.

**Appendix Tables B-2 through H-2 publish the measured cement composition of every one of
the seven elements** — C3S, C2S, C3A, C4AF, SO3, MgO, Na₂O-eq and Blaine fineness, from the
mill certificate. Appendix Tables B-4 through H-4 add seven days of local weather per site.

That matters because `docs/VALIDATION.json` says, in its own notes on the USBR cases:

> Cement chemistry — C3A, C3S, SO3 and Blaine fineness — is NOT reported in DSO-12-02. This
> is why the test is coverage and not point error. […] The Schindler-Folliard tau regression
> is highly sensitive to them: tau moves from 25.8 h to 15.2 h across a plausible SO3 range
> alone.

**The Auburn dataset does not have that problem, and the runs in §2.2.3 did not use the
chemistry anyway** — because `MixSpec` has no field for it. A design mix goes down the
`w_cm` / `fly_ash_frac` branch of `app/services/simulate.py::to_mix`, which calls
`tau_hours` with the hardcoded generic values in `physics/season_analysis.py`:

```python
P_FLY_ASH_CAO = 0.06
P_C3A, P_C3S, P_SO3 = 0.08, 0.55, 0.03
BLAINE_M2_KG = 380.0
```

Albertville's mill certificate reads C3A **5.4%**, C3S **60.9%**, SO3 **2.79%**, Blaine
**448.9 m²/kg** — all four different, and Blaine 18% higher. Measured on this commit:

| | assumed | Albertville measured |
|---|---|---|
| `tau_hours` | **17.339 h** | **16.341 h** |
| `cement_heat_j_per_g` from the Bogue compounds | no Bogue set is assumed at all | **462.2 J/g** |

Blaine alone takes tau to 15.165 h. And 462.2 J/g is against the **510** these runs used
(Type I) and the **505** now in `H_CEM_BY_TYPE["I/II"]` — **9.4% less heat**.

**Say the honest thing about what that would do, because the two effects point opposite
ways.** A shorter tau peaks earlier, which is the sign of the undiagnosed +8.7 h late-peak
bias in `docs/LIMITATIONS.md` §9 — about 1 h of Albertville's 14.7 h error, from measured
chemistry alone, for nothing. Less cement heat runs the peak colder, and Albertville is
already 3.8 °C cold, so the **5.40 °C mean absolute error headline would probably get
worse**, not better. This is a fair test that has not been run, not a fix waiting to be
applied, and it should be offered to a judge in exactly those words.

`cement_heat_j_per_g` already exists at `physics/equations/hydration.py` and carries the
seven Bogue coefficients. Nothing on the API path can reach it, because `MixSpec` carries
no Bogue fields, and its only test (`tests/test_hydration.py`) checks that ordinary portland
cement lands in the 400–520 J/g literature band rather than pinning a value — so the
function is plausible, not verified against a measured cement. Wiring four optional numbers
through `to_mix` is the smallest change with the largest evidentiary return in this repo,
and it is deliberately **not** in this build.

## 2.3 The free hourly weather source that makes those cases runnable

**Open-Meteo Historical Weather API.** Free for non-commercial use, **no API key**, hourly
data back to 1940, worldwide.

📄 <https://open-meteo.com/en/docs/historical-weather-api>
🔗 Endpoint: `https://archive-api.open-meteo.com/v1/archive`

Re-verified 2026-08-27: the exact request below, for Albertville, AL, 2015-07-31 to
2015-08-07, returned **HTTP 200, 8,005 bytes, 192 hourly records**, with units reported as
`°C`, `%`, `km/h`, `%`, `W/m²`.

It supplies **exactly the five arrays `AmbientSpec` needs**:

| Open-Meteo field | Unit | → `AmbientSpec` field | Conversion |
|---|---|---|---|
| `temperature_2m` | °C | `air_temp_c` | none |
| `relative_humidity_2m` | % | `rh_frac` | `/100` |
| `wind_speed_10m` | km/h | `wind_ms` | `/3.6` |
| `cloud_cover` | % | `cloud_pct` | none |
| `shortwave_radiation` | W/m² | `ghi_w_m2` | none |

**Why this is strategically important, beyond validation.** `docs/SPEC-00-MASTER.md` §4.6
records that FortyGuard carries **no wind field at all** ("confirmed by exhaustive key
search") and that `solar_irradiance` is **daily-only** clear-sky GHI/DNI/DHI with no hourly
shape — and it names Open-Meteo as the intended source, explicitly permitted by the
hackathon FAQ. This is that plan, working. It also means:

- Every one of the 7 Auburn cases, and both USBR field cases, can be re-run with **real
  measured hourly weather** instead of the reconstructed diurnal curve.
- `docs/LIMITATIONS.md` §8 identifies that reconstruction as the most likely cause of the
  −26.5 °C error at 12 h: with no hourly weather for 2008, the daily minimum is inferred as
  `2·mean − max`, forcing a symmetric diurnal swing real weather does not have, and the
  ensemble does not vary it, so its error sits **outside** the band rather than inside it.
  Open-Meteo removes that inference entirely for any date from 1940 onward.

That is a concrete, credible "what's next" slide, and it costs nothing.

## 2.4 Standards and papers — where every constant comes from

Every url in this section and in §2.5 was fetched on **2026-08-27**. Two were dead and are
corrected here: ACI 306.1 was `ItemID=306110` (404, now `306190`) and TxDOT 0-4563-1 was on
`ctr.utexas.edu` (404, now the `library.ctr.utexas.edu` copy). One could not be verified at
all and says so in its own row. `astm.org`, `rosap.ntl.bts.gov`, `eng-tips.com`,
`giatecscientific.com` and `usbr.gov` refuse a bare crawler and are fine in a browser.

| What it fixes in the code | Source | Link |
|---|---|---|
| Hydration model: `α_u`, `H_u`, `τ`, `β` regressions | Schindler, A. K. & Folliard, K. J. (2005), *Heat of Hydration Models for Cementitious Materials*, **ACI Materials Journal 102(1), 24–33** | [ACI abstract](https://www.concrete.org/publications/internationalconcreteabstractsportal.aspx?m=details&id=14246) · [Semantic Scholar](https://www.semanticscholar.org/paper/Heat-of-Hydration-Models-for-Cementitious-Materials-Schindler-Folliard/cbf97cf981ed9fb32bedc18c6aa424f3207c3202) |
| Maturity / equivalent age, `E = 33500`, datum −10 °C | **ASTM C1074**, *Standard Practice for Estimating Concrete Strength by the Maturity Method* | <https://www.astm.org/c1074-19.html> |
| Evaporation limit, Uno equation, worked example 0.17 lb/ft²/h | **ACI 305.1-14**, *Specification for Hot Weather Concreting*; ACI 305R guide | [ACI 305.1](https://www.concrete.org/store/productdetail.aspx?ItemID=305114) |
| 35 °F (19.4 °C) differential limit; 160 °F max in-place | **ACI 301**, *Specifications for Structural Concrete*; **ACI 207.2R**, *Report on Thermal and Volume Change Effects on Cracking of Mass Concrete* | [ACI 207.2R](https://www.concrete.org/store/productdetail.aspx?ItemID=207207) |
| Cold weather placement | **ACI 306.1** | [ACI SPEC-306.1-90](https://www.concrete.org/store/productdetail.aspx?ItemID=306190) |
| Formwork removal / strip strength | **ACI 347**, *Guide to Formwork for Concrete* | [ACI 347](https://www.concrete.org/store/productdetail.aspx?ItemID=34714) |
| DEF threshold 155 °F (68.3 °C), chemistry conditionality | USBR DSO-12-02 (as above) | <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-12-02.pdf> |
| DEF field consequences — the Texas precast box-beam case | UT Austin CTR 0-5218-1, *Investigation of the Internal Stresses Caused by Delayed Ettringite Formation* | <https://library.ctr.utexas.edu/ctr-publications/0-5218-1.pdf> |
| DEF + ASR field survey | UT Austin CTR 0-4085-1 | <https://library.ctr.utexas.edu/ctr-publications/0-4085-1.pdf> |
| Mass concrete thermal management, cost of cooling | **GDOT Research Project 19-04 Phase II**, *Investigation and Guidelines for Best Practices of Mass Concrete Construction Management* (Jul 2019 – Jul 2022) | <https://rosap.ntl.bts.gov/view/dot/64459/dot_64459_DS1.pdf> |
| Alternative thermal property models | USBR **DSO-2017-05**, *Comparison of Thermal Property Models for Concrete* | <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-2017-05.pdf> |
| Temperature rise with Class N pozzolan | USBR **DSO-2017-04** | <https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-2017-04.pdf> |
| Maturity for early opening — a DOT that measured the payoff | Iowa State InTrans, *Maturity Method for Early Opening of Concrete Pavements* (Spring 2025) | <https://www.intrans.iastate.edu/wp-content/uploads/2025/04/maturity_method_for_concrete_pvmt_early_opening_spring_2025_MB.pdf> |
| Maturity implementation, WSDOT | *Use of the Maturity Method in Accelerated PCCP Construction* | <https://www.wsdot.wa.gov/research/reports/fullreports/698.1.pdf> |
| Maturity implementation, Louisiana | LTRC, *Implementation of Maturity for Concrete Strength Measurement and Pay* | <https://rosap.ntl.bts.gov/view/dot/34372> — the `ltrc.lsu.edu/pdf/2017/FR_584.pdf` url that was here refuses connection and the host has moved to `ltrc.la.gov`, where FR 584 could not be confirmed to exist. This is the ROSAP mirror of the same programme; the original is **not** cited because it could not be verified. |
| FHWA's own maturity guidance | FHWA HIF-19-005, *Utilizing the Maturity Concept for Determining Early Strength* | <https://www.fhwa.dot.gov/pavement/concrete/trailer/resources/hif19005.pdf> |
| One-page industry explainer of thermal cracking (good for a slide) | NRMCA **CIP 42 — Thermal Cracking** | <https://www.concreteanswers.org/CIPs/CIP42.htm> |

**The one caveat that keeps you honest:** `docs/LIMITATIONS.md` closes by noting that
`physics/constants.py` names the *standard* a group of constants came from but not the
page, table or equation for each individual number, and that two carry PROVISIONAL markers
rather than citations (`BETA_DEFAULT = 0.9`, "eqn [11] SO3 exponent sign unconfirmed"; and
`PLACEMENT_MAX_C = 32.0`, "ACI 305, often project-specific"). If you show this table on
screen, show that sentence too.

## 2.5 Benchmark tools — what to compare against

| Tool | What it is | Why it matters to you | Link |
|---|---|---|---|
| **ConcreteWorks** | Developed at UT Austin's Concrete Durability Center under TxDOT funding. Mixture proportioning, thermal analysis, cracking probability, chloride service life. Modules for mass concrete shapes, bridge decks, precast beams, pavements. Used by TxDOT, Iowa DOT and others. Free. | **This is the benchmark.** Its published error on your seven Auburn elements is in §2.2.3. | [TxDOT presentation](https://www.dot.state.tx.us/iheep2009/presentations/4A_ConcreteWorks_AndyNaranjo.pdf) · [Iowa DOT adaptation report](https://rosap.ntl.bts.gov/view/dot/54607/dot_54607_DS1.pdf) |
| **HIPERPAV III** | FHWA's free early-age concrete pavement tool, first released 1996. A **transient one-dimensional finite-difference** temperature model with heat of hydration, conduction, convection including evaporative cooling, solar radiation and irradiation — and automated weather download from the National Weather Service. | Nearly the same physics stack as SatAlite, one dimension fewer, and federally validated. Cite it when a judge asks "is this a real approach?" | [FHWA HIPERPAV](https://www.fhwa.dot.gov/pavement/concrete/hiperpav.cfm) · [User manual FHWA-HRT-14-087](https://www.fhwa.dot.gov/publications/research/infrastructure/pavements/14087/14087.pdf) |
| **b4cast** | Commercial 3D FE thermal/stress analysis for hardening concrete. Consultant-grade. | The high end. What a large contractor pays a specialist to run. | <https://b4cast.com/> |
| **Prediction Model for Concrete Behavior** | The UT Austin report ConcreteWorks was built from (TxDOT 0-4563-1, Oct 2007, rev. May 2008). | The provenance chain for ConcreteWorks' physics. | <https://library.ctr.utexas.edu/ctr-publications/0-4563-1.pdf> |

## 2.6 The problem, in practitioners' own words

Use these as B-roll, as quotes on a slide, or simply to check that your framing matches how
the trade actually talks about it.

### YouTube — engineers and specialists on the exact problem

| Video | Why it is useful |
|---|---|
| [Mass Concrete: Does My Project Need a Thermal Control Plan?](https://www.youtube.com/watch?v=yEUU4X9Xc-A) | The decision SatAlite's pour-window strip is trying to inform, explained by a testing firm. |
| [What Are Thermal Control Plans for Mass Concrete?](https://www.youtube.com/watch?v=J-t28eKG3lM) | Opens on "mass concrete pours are becoming more common and presenting new challenges" — the market framing in one line. |
| [Mass concreting: Monitoring temperature using thermocouple](https://www.youtube.com/watch?v=foaAG26vhco) | Actual site footage of the manual instrumentation SatAlite is an alternative *planning* tool to. |
| [How To Install Thermocouple — Temperature Monitoring for Raft Concrete](https://www.youtube.com/watch?v=z4n2fPvA6i0) | Shows the labour involved. Good silent B-roll under the "nobody records what the element experienced" line. |
| [The Importance of Monitoring Temperature Differentials in Mass Concrete](https://www.youtube.com/watch?v=vpVxG6rphz8) | Giatec, i.e. a vendor whose whole product is this problem. |
| [Mass Concrete — Temperature Control and Monitoring: Essential Techniques](https://www.youtube.com/watch?v=gvIDdqJiDCM) | Oct 2024, recent and comprehensive. |
| [BCRC Webinar — Thermal and Early Age Crack Modelling of Large Concrete Elements](https://www.youtube.com/watch?v=QnI3WkP6Y7s) | Academic-grade treatment of exactly what the solver does. |
| [Thermal Cracking in Reinforced Concrete](https://www.youtube.com/watch?v=LGImMUs7AS0) | "Thermal cracks can ruin a well-designed concrete project if not designed for properly." |
| [Episode 5: Preventing Thermal Cracks in Mass Concrete](https://www.youtube.com/watch?v=LAESAmAu9v4) | Prevention framing. |
| [Early thermal cracking](https://www.youtube.com/watch?v=dQX2zbwVlMI) | Short, visual. |
| [Challenges with Hot Weather Concreting](https://www.youtube.com/watch?v=IN5UnCZVaNg) | Aug 2024. The Phoenix scenario, generally. |
| [The Challenges of Hot Weather Concreting](https://www.youtube.com/watch?v=r4NfOnZpq5U) | Apr 2024, covers mass concrete specifically. |
| [Hot Weather Concrete Biggest Problems & Solutions](https://www.youtube.com/watch?v=cxVTLBZApCA) | Contractor's-eye view. |
| [Plastic Shrinkage and Cracks in Concrete](https://www.youtube.com/watch?v=S-s4vagWXIM) | The evaporation flag, visually. |
| [Adding Water + Hot Weather Concreting](https://www.youtube.com/watch?v=YeET3lk0b9s) | The bad-practice workaround your tool is an alternative to. |
| [Concrete Maturity Monitoring](https://www.youtube.com/watch?v=kdZbyzRooBU) · [The Maturity Method](https://www.youtube.com/watch?v=UaUJk65UV8E) · [Standard Practice for Estimating Concrete Strength by the Maturity Method](https://www.youtube.com/watch?v=8JtTv5BRjR8) | ASTM C1074 explained. Useful if a judge does not know the standard. |

### Engineering forums — practitioners asking the exact question

| Thread | Substance |
|---|---|
| [Thermal Effects of Mass Concrete Pour — Eng-Tips](https://www.eng-tips.com/threads/thermal-effects-of-mass-concrete-pour.252481/) | Practising engineers on cooling with water, blanketing to control differential, starting early in the morning when aggregates are coolest, icing the mix water. **"Start early in the morning when the aggregates are at their coolest"** is the pour-window recommendation, arrived at by hand, by a working engineer. That is your feature in one sentence. |
| [Maximum Allowable Heat of Hydration and Differential Temperatures in Mass Concrete — Eng-Tips](https://www.eng-tips.com/threads/maximum-allowable-heat-of-hydration-and-differential-temperatures-in-mass-concrete.365100/) | Argument over what the limit actually is and where it comes from — exactly the ambiguity `physics/limits.py` has to resolve. |
| [Mass concrete — Eng-Tips](https://www.eng-tips.com/threads/mass-concrete.504962/) | General practice thread. |

### Industry pages worth a screenshot

- [Giatec — The Importance of Monitoring Temperature Differentials in Mass Concrete](https://www.giatecscientific.com/education/the-importance-of-monitoring-temperature-differentials-in-mass-concrete/)
- [Converge — Thermal stresses and temperature control of mass concrete](https://www.converge.io/blog/thermal-stresses-and-temperature-control-of-mass-concrete)
- [Beton Consulting Engineers — Thermal control plans for mass concrete](https://www.betonconsultingeng.com/thermal-control-plans-for-mass-concrete-2/)
- [NRMCA CIP 42 — Thermal Cracking](https://www.concreteanswers.org/CIPs/CIP42.htm)
- [Concrete Bridge Views — Mass Concrete Specifications: Two States' Perspectives](https://concretebridgeviews.com/2016/03/mass-concrete-specifications-two-states-perspectives/) — notes that ACI 301's 35 °F is "very conservative" and that **MnDOT allows the differential to rise to 45 °F after 48 h and 60 °F after 7 days**. Useful nuance if a judge challenges the fixed limit.
- [Arizona Rock Products Association — Hot Weather Concrete](https://www.azrockproducts.org/wp-content/uploads/ARPA-Hot-Weather-Concrete.pdf) — the Phoenix case, from the local trade association.

### On Reddit

I could not retrieve Reddit thread URLs: Reddit blocks the crawler this research ran
through, so **any Reddit link in this document would be fabricated, and there are none.**
Rather than invent them, here are the searches that will surface the real threads in about
two minutes. Run them logged in, on reddit.com's own search or via Google:

```
site:reddit.com/r/civilengineering  mass concrete temperature differential
site:reddit.com/r/civilengineering  "thermal control plan"
site:reddit.com/r/Concrete          "hot weather" pour cracked slab summer
site:reddit.com/r/Concrete          "when can we strip" forms cylinder break
site:reddit.com/r/StructuralEngineering  mass concrete DEF ettringite
site:reddit.com/r/Construction      waiting on cylinder breaks schedule delay
```

Screenshot whichever thread is most vivid and cite it by title, subreddit and date. A
real thread you found yourself beats a link I could not verify.

## 2.7 The hackathon itself

**FortyGuard Hackathon'26** — a free global virtual hackathon, powered by FortyGuard's
NVIDIA-recognised Temperature API providing hyperlocal urban temperature measured **two
metres above ground**, with a **$6,000 prize pool** across four tracks: **AI Agents,
Predictive Models, Dashboards, and Interactive Maps**.

🔗 <https://www.fortyguard.com/hackathon26>
📰 [Entrepreneur Middle East — FortyGuard Launches Global AI Hackathon Focused on Climate Innovation](https://mena.entrepreneur.com/business-news/fortyguard-launches-global-ai-hackathon-focused-on-climate-innovation)

> **Deadline: 30 August 2026.** Confirmed by the team. The 3–17 August window in the press
> coverage above is the *original* schedule; the hackathon was postponed after that article
> ran. `docs/SPEC-00-MASTER.md` carries the corrected 18–30 August dates. **Three days left
> as of this writing (27 August).**

On tracks: SatAlite spans **Predictive Models** (the solver and the ensemble) and
**Interactive Maps** (the 221-tile heatmap view with click-to-pour). If you must pick one,
pick **Predictive Models** — the map is the more common submission and the physics is what
nobody else will have.

---

# Section 3 — Competitor and prior-art map

Judges ask "why doesn't this already exist?" It partly does. Knowing exactly which part is
what makes the answer credible.

## 3.1 The landscape

| | What it does | What it costs | What it needs | The gap |
|---|---|---|---|---|
| **Embedded sensors** — Giatec SmartRock, Converge Signal, Maturix, Command Center | Measure real in-place temperature, compute maturity, report strength in real time. The correct answer for QA. | SmartRock listed at **$249.89 per sensor**, sold in packs of 10. Multiple sensors per element. | The pour must **already exist**, and someone must have installed sensors before it. | **They cannot tell you anything before the concrete is placed.** |
| **ConcreteWorks** | Predicts temperature, cracking risk, chloride service life. Free, DOT-grade. | Free | Windows desktop install, expert inputs, a weather file. No live weather, no hyperlocal source. | Desktop tool, not a live decision surface. Uses generic climate data, not the temperature of *this* street. |
| **HIPERPAV III** | 1D FD early-age model with hydration, convection, solar, evaporation. Downloads NWS weather. Free, FHWA. | Free | Windows install. Scoped to **pavements**. | Not for bent caps, walls, columns or slabs-on-grade. 1D. |
| **b4cast** | 3D FE thermal and stress analysis of hardening concrete. | Commercial licence | A specialist to drive it. | Cost and expertise. Not a thing a site engineer opens on a Tuesday. |
| **Spreadsheets + ACI nomograms** | What most projects actually use. | Free | An engineer's afternoon. | No uncertainty band, no hyperlocal weather, no what-if in seconds. |
| **Cube/cylinder tests** | The legal answer for acceptance. | Cheap per test, expensive in **schedule** | A lab, a truck, and 7 to 28 days. | Cures in a 27 °C tank. **Does not measure the element.** DSO-12-02 measured the gap: in-situ concrete was 77% stronger at 24 h and 15% weaker at 90 d than the cylinder beside it. |

## 3.2 Where SatAlite actually sits

Not "better than ConcreteWorks". The honest positioning, in one sentence:

> **Everything above either measures a pour that already exists, or predicts one from
> generic climate data on a desktop. SatAlite predicts one that does not exist yet, from the
> temperature of the specific city block it will sit on, in a browser, with an uncertainty
> band, in seconds.**

Three differentiators, in descending strength:

1. **It runs before the pour.** Every sensor product is post-hoc by construction. This is
   the planning decision — *which hour do we place?* — and no sensor can answer it.
2. **The weather is hyperlocal and it is wired to the solver, not decorative.**
   `POST /api/ambient` takes `reduce: "tile"` and shapes the diurnal curve from one 100 m
   cell's own min/mean/max. Click a cell on the map and the cure re-solves. **And the repo
   already publishes how small that effect is** — over the demo AOI the two most different
   cells are 0.37 °C apart in daily minimum, worth 0.048 °C on peak core temperature.
   Owning that number is worth more than overselling it.
3. **It ships its own error bars and its own limitations document.** Nothing else in the
   table above hands you a p05/p95 band alongside a file listing what is wrong with the
   model. That is a differentiator with judges even though it is not a feature.

## 3.3 The honest weakness of the positioning

`docs/SPEC-00-MASTER.md` §3.2 records a **negative result**, measured and published in the
repo: across a 2.52 km² downtown AOI the standard deviation of daily average temperature is
**0.033 °C**, and even across 119.59 km² it is only 0.103 °C — while a **single tile swings
32.80 → 40.28 °C in one day**. Temporal variation is **75× spatial**.

So the hyperlocal claim is real but small, and the product is fundamentally **temporal**.
Say this before a judge finds it. The framing that survives contact:

> "We tested whether spatial variation drove the answer. It does not — it is 75× smaller
> than the diurnal swing. So we built the temporal product and wired the spatial signal to
> the solver anyway, because it is real, measurable, and it is what the API uniquely
> provides. Here is the exact size of it: 0.37 °C between the two most different cells,
> 0.048 °C on peak core temperature."

A judge who hears you volunteer that will trust the rest of your numbers.

---

# Section 4 — Demo video script and judge Q&A

## 4.1 Before you record

- Run the [warm-up drill](#19-the-pre-demo-warm-up-drill). All of it, including step 4.
- Confirm the status dot is **green** and hover it — the tooltip names the version and the
  origin it reached.
- Have `docs/VALIDATION.md` and `docs/LIMITATIONS.md` open in tabs you can cut to.
- Have the ConcreteWorks comparison table from §2.2.3 as a full-screen slide.
- Record at a resolution where the pour-window table's numbers are legible. That table is
  the argument.

## 4.2 The script (target 3:00, adjust to the rules)

**0:00–0:20 — The problem, concretely**

> "Concrete does not gain strength on the calendar. It gains strength on temperature times
> time. The cube that decides when you strip formwork cures in a 27 °C tank. The element
> itself sits in 44 °C Phoenix sun, or through a cold night. Nobody records what the element
> experienced — that information evaporates the moment the pour finishes."

*B-roll: the thermocouple-installation footage from §2.6.*

**0:20–0:40 — The evidence that the gap is real**

> "The US Bureau of Reclamation measured the gap. Same mix, cured three ways. At 24 hours
> the concrete cured on the real field temperature curve was 77% stronger than the cylinder
> beside it. By 90 days it was 15% weaker. And their own sentence: *the average three-day
> strength of the in-situ cured concrete is comparable to the average fog-cured 28-day
> strength.* Three days versus twenty-eight."

*On screen: DSO-12-02 Table 9.*

**0:40–1:10 — The product, live**

Open the studio. It is already solving on first paint — never show an empty form.

> "SatAlite pulls hyperlocal air temperature from FortyGuard's tOS API — two metres above
> ground, 100 metre tiles — runs a 2D finite-volume thermal solver coupled to a
> Schindler–Folliard hydration model, and reports peak temperature, maximum gradient, and
> ASTM C1074 maturity-based strength gain."

Scrub the time slider. Drag the clip plane. **Show the red core inside the blue shell.**

**1:10–1:40 — The money shot: the pour window**

Bring up the pour-window strip.

> "Same element, same day, same mix. Only the start hour changes. Placing at 2 p.m. gets you
> to strip strength **fastest** — and it is also the row that breaches the DEF limit and the
> cracking differential. Fastest is worst. We never collapse that into one score, because
> the two answers point in opposite directions and an engineer needs to see both."

*This is the most persuasive fifteen seconds in the demo. Do not rush it.*

**1:40–2:05 — The hyperlocal claim, wired and sized**

Switch to the Map view. 221 measured tiles over the real ground.

> "This is the day the solve was given — the actual measured field. Click a cell and the
> cure re-solves from that one 100 metre tile's own minimum, mean and maximum, not the
> average of all 221. And the honest size of it: across this city block the two most
> different cells are 0.37 °C apart in daily minimum, which moves peak core temperature by
> 0.048 °C. Real, measurable, and small — because 2.5 km² is small."

**2:05–2:40 — ⭐ Validation, and the benchmark**

Full-screen the §2.2.3 table.

> "Seven real Alabama DOT mass concrete elements, instrumented in the field, published by
> Auburn University. Nothing in our model has ever seen them. We ran all seven with free
> public hourly weather and no calibration. Mean absolute error on peak core temperature:
> **5.4 °C**. ConcreteWorks — the TxDOT-funded tool DOTs actually use — scores **4.9 °C** on
> the identical seven elements, published by the same authors in the same table.
> **Half a degree apart.** We are not claiming we beat it. We are showing we are in the same
> room, using free weather and no lab calibration."

**2:40–3:00 — The limits, volunteered**

> "Three things you should know before trusting a number. Our strength calibration is
> literature defaults, not measured on any mix here, and every payload carrying a strip time
> says so. Our time-to-peak runs 8.7 hours late, systematically. And this is not an ASTM
> C1074 instrument — C1074 requires the temperature history to be **recorded**; we predict
> it. If a spec calls for maturity-based acceptance, it calls for a thermocouple. This is
> for the decision you make *before* there is anything to instrument. It is all written down
> in `docs/LIMITATIONS.md`, in the repo, before you asked."

## 4.3 Judge Q&A — the eight questions you will get

**Q: "Your own validation says 1 of 3. Why should I believe any of this?"**

> Because we published it that way. Two of three USBR field cases fail our own 90% coverage
> bar, and one of them has a 25.6 °C band we flag as too wide to be evidence at all. That is
> in the report the app serves at `/api/validation`. Then we found a second, independent
> dataset — seven Alabama DOT elements with a published ConcreteWorks benchmark — and scored
> 5.4 °C mean absolute error against ConcreteWorks' 4.9 °C. One dataset is a data point.
> Two, one of which we did badly on, is a picture.

**Q: "You fitted a constant to your own validation case. Isn't that circular?"**

> Yes, for one constant, and we wrote it down before you asked. `H_CEM_DEFAULT` moved from
> 470 to 500 J/g because Stony Gorge's measured field rise exceeded our predicted *adiabatic*
> rise, which is physically impossible. Stony Gorge is also validation case 2, so its
> agreement is not independent evidence about that constant — `docs/LIMITATIONS.md` §1 says
> exactly that. The Schindler–Folliard regressions themselves are untouched; no coefficient
> in them has moved. And the Alabama cases in §2.2 have never touched any constant here.

**Q: "How do I know the solver is right and not just tuned to look right?"**

> Five golden tests, and **not one of them stores a number this solver produced.** Golden 1
> is closed-form: with every loss switched off the total rise is pure energy bookkeeping,
> `ΔT = H_u·C_c·α_u/(ρ·c_p)` — arithmetic that would be true if this solver did not exist,
> and it is what catches the J/g → J/kg error. Golden 3 is an exact identity asserted to
> `rel=1e-12` at four different reference temperatures. Golden 4 is the first law checked
> every timestep. Golden 5 is grid convergence. Separately, the boundary scheme is measured
> at second order — p = 2.0498 baseline, 2.0067 with the film off, 2.0053 sealed adiabatic.
> And the ACI 305.1 evaporation conversion reproduces the standard's own worked example to
> six digits.

**Q: "Isn't this just ConcreteWorks in a browser?"**

> ConcreteWorks is a Windows desktop tool with generic climate data, and it is very good. It
> cannot use the temperature of the specific city block your pour is on, it does not give
> you a probability band, and nobody opens it to answer "4 a.m. or 2 p.m.?" in ninety
> seconds. We also do less than it does — no chloride service life, no mixture proportioning.
> We are the live decision surface, not the desktop analysis suite.

**Q: "Your differential numbers are way off — 46 °C predicted against 11 °C measured."**

> Correct. Part of it was a measuring-point bug, which we found and fixed; the rest is a
> real defect we have not solved. The bug: our surface series was the **true free surface**,
> while ACI 301's 35 °F is written against a thermocouple cast a few inches under a face —
> two different quantities, one limit. The solver now samples at a configurable sensor depth
> and the cracking flag reads that. But we measured what the fix is worth before claiming
> it: about 5 °C at 50 mm and about 17 °C even at 150 mm, against a gap of 24 to 36 °C. So
> the measuring point was wrong and is now right, and the over-reading is still there. Since
> our peak core temperature is roughly right on the same runs, the core is not the problem —
> the modelled surface runs too cold, which points at the boundary and points the same way
> as our late-peak bias. It is written up as limitation §10 rather than smoothed over. Read
> our cracking flag as conservative, and on a thick section as close to uninformative.

**Q: "How is this hyperlocal if the spatial spread is 0.03 °C?"**

> Because we measured that and told you. Across 2.52 km² the standard deviation of daily
> average temperature is 0.033 °C; a single tile swings 7.5 °C in a day. Temporal variation
> is 75× spatial, so we built the temporal product. The spatial signal is still wired to the
> solver — click a tile and the cure re-solves from that tile's own triple — and we publish
> exactly what it is worth: 0.37 °C between the extreme cells, 0.048 °C on peak core
> temperature. We would rather show you a small honest number than a large questionable one.

**Q: "Can I use this to decide when to strip formwork?"**

> Not on its own, and the app says so in the payload. Our strength calibration is
> `GRADE_PARAMS`, which is labelled PROVISIONAL in its own source comment — nominal grades
> converted from psi, ultimate taken as 1.15× nominal, `τ_s` and `β_s` set mid-range and not
> measured on any mix here. Our striking criterion is 75% of a *modelled* 28-day strength,
> where industry practice specifies absolute values around 10–20 MPa. Optimistic is the
> unsafe direction: too early takes formwork off concrete that has not reached strength. Use
> it to plan, then verify in situ.

**Q: "What would you do with another month?"**

> Three things, in order. One: accept **measured cement chemistry** on the wire. The Auburn
> report publishes C3A, C3S, SO3 and Blaine for all seven elements, and we ignored all of it
> because `MixSpec` has no field for it — we ran the generic 0.08 / 0.55 / 0.03 / 380 against
> Albertville's real 0.054 / 0.609 / 0.0279 / 448.9. That moves tau from 17.34 h to 16.34 h,
> which is roughly an hour off our 8.7 h late-peak bias, and it drops cement heat 9.4%, which
> would probably make our 5.4 °C peak error *worse*. We want to know which. The function that
> does it, `cement_heat_j_per_g`, is already in the repo and unreachable from the API.
> Two: re-run every validation case with **real hourly weather** from the Open-Meteo archive
> instead of the reconstructed diurnal curve — `docs/LIMITATIONS.md` §8 identifies that
> reconstruction as the most likely cause of the −26.5 °C error at 12 h. Three: replace the
> invented forecast error band — `provisional_error()` returns σ ramping 0.5 → 2.0 °C with
> `n_pairs = [0]*12`, zero measured pairs, and it ranks **2nd of 10** parameters on strip
> time at −5.67 h. The machinery to replace it (`empirical_forecast_error()`) exists and is
> tested; it just has no data yet.

---

# Section 5 — Known-weakness disclosure kit

`docs/LIMITATIONS.md` is an unusual asset. Most submissions hide this; yours is written down
and served by the API. Handled well it is a credibility multiplier. Handled badly a judge
finds it and it looks like a confession.

## 5.1 The rule

**Volunteer every limitation that changes how a judge should read a number. Do not volunteer
the ones that change nothing.**

## 5.2 State these out loud

| Limitation | Say it as |
|---|---|
| Validation stands at 1 of 3 | "Two of three field cases fail our own bar. Here is the second dataset where we did better, and here is the benchmark." |
| One constant fitted to a validation case | "`H_CEM_DEFAULT` moved 470 → 500 against Stony Gorge. That case's agreement is therefore not independent. §1 of our limitations file." |
| Strength calibration is provisional | "Literature defaults, not measured on any mix here. Every payload carrying a strip time says so." |
| Not an ASTM C1074 instrument | "C1074 requires the temperature history to be **recorded**. We predict it. Not a compliance document." |
| Time to peak runs +8.7 h late | "Systematic, not scatter. Every one of seven errors positive." |
| Differential over-reads | "Definition mismatch on the surface probe, plus probable excess surface loss. Explained above." |
| Forecast band is invented | "σ ramps 0.5 → 2.0 °C with zero measured pairs, and it says so in its own docstring. It ranks 2nd of 10 on strip time." |
| Spatial variation is small | "0.033 °C over 2.5 km². We measured it, it is 75× smaller than the diurnal swing, so we built the temporal product." |
| The Auburn runs used generic cement chemistry | "The report publishes the mill certificates and we could not consume them — `MixSpec` has no chemistry field. Our 5.4 °C was scored with assumed C3A, C3S, SO3 and Blaine. Feeding the real ones moves tau an hour earlier and cement heat 9.4% lower, and we do not yet know whether the peak error improves or worsens." |

## 5.3 Do not volunteer these unless asked

They are in `docs/LIMITATIONS.md` under "Known, unfixed, and no number moves", and by the
document's own analysis none of them changes a published result:

- `ALPHA_U_CAP = 1.09` vs the 1.0 in two secondary sources — it never binds (α_u computes to
  0.8204 standard, 0.7383 Deer Creek).
- `EVAP_LIMIT_KG_M2_H = 1.0` vs ACI 305's 0.976464 — 2.41% loose, and both placement hours
  breach by margins far larger than that on every sampled day.
- Missing per-constant page citations.

If asked, answer plainly and cite the file. Do not lead with them.

## 5.4 The one screen that does the most work

Put `docs/LIMITATIONS.md`'s **"What is solid"** section on a slide. It is the strongest page
in the repo and most people never scroll to it:

> **None of the five golden tests is a regression lock against this code's own output.**
> Not one of them stores a number this solver produced and checks that it still produces it.

Then the four supporting facts: the closed-form energy check, the `rel=1e-12` maturity
identity at four reference temperatures, the first law checked every timestep, and the
measured second-order boundary convergence (p = 2.0498 / 2.0067 / 2.0053).

## 5.5 The trap to avoid

Do **not** say "we validated against real data" without immediately saying which cases and
what the coverage was. A judge who checks and finds 1 of 3 after hearing "validated"
discounts everything else you said. A judge who hears "1 of 3, and here is the second
dataset and the benchmark" concludes you can be trusted with a number.

---

# Section 6 — Pre-submission checklist

## 6.1 Time remaining

Deadline **30 August 2026** — three days from this writing. The 3–17 August window that
appears in press coverage is the pre-postponement schedule; ignore it. Everything below is
ordered so that stopping early still leaves you with a submission.

## 6.2 Fresh-clone test (the one people skip)

Clone into an empty directory, as a judge would, and run it end to end. **Run this under
bash** — the `&` backgrounding and the `cd ../frontend` after it behave differently in fish:

```bash
git clone https://github.com/MuazTPM-YT/satalite.git /tmp/satalite-fresh
cd /tmp/satalite-fresh

cp .env.example .env                                # then paste the key
cp frontend/.env.local.example frontend/.env.local

cd backend && uv sync && uv run uvicorn app.main:app --port 8000 &
cd ../frontend && npm install && npm run dev
```

Then confirm, in a fresh browser profile:

- [ ] `http://localhost:8000/api/health` returns `{"status":"ok","version":"0.1.0"}`
- [ ] `http://localhost:3000` paints a **solved** studio on first load, not an empty form
- [ ] The status dot is green and its tooltip names the version and origin
- [ ] The Map view draws 221 tiles and the Phoenix pour site is marked
- [ ] Clicking a measured cell re-solves (and does **not** ask for credits — the shipped day
      is free)
- [ ] The Validation panel is populated (`docs/VALIDATION.json` is committed, so it should be)
- [ ] The Season panel is populated (`season-analysis.json` is committed)
- [ ] The Ensemble band is populated (`demo-ensemble.json` is committed)

## 6.3 Green-checks run

```bash
cd backend
uv run ruff check .
uv run mypy physics app          # strict on physics/, lenient elsewhere
uv run pytest -v                 # expect 228 passed
uv run pytest validation/ -m validation   # regenerates docs/VALIDATION.json + .md

cd ../frontend
npm run lint
npx tsc --noEmit
npm run build
```

If `pytest validation/` changes `docs/VALIDATION.json`, **commit it** — the deployed
`/api/validation` serves that file, and a stale one shown next to a fresh claim is the kind
of thing a careful judge notices.

Frontend self-checks (plain scripts, not a framework — run the ones you cite on camera):

```bash
cd frontend
npx tsx src/lib/test_scenario.ts        # candidate start hours, config round trip
npx tsx src/lib/test_mercator.ts        # projection, against the slippy-map spec
npx tsx src/lib/test_basemap.ts         # tile-source override, and what it refuses
npx tsx src/lib/test_stats.ts           # Wilson interval at 0/n and n/n
# these need the backend up:
npx tsx src/lib/test_studio_live.ts
npx tsx src/lib/test_probe_live.ts      # viewer and solver agree on the same point
npx tsx src/lib/test_shapes_live.ts     # all eight shapes, vertex for vertex
npx tsx src/lib/test_ensemble_live.ts
npx tsx src/lib/test_heatmap_live.ts    # the map's field, and that it never spends
```

## 6.4 Secrets and hygiene

**These are bash.** Your login shell is fish, where `<<<` is a syntax error — run them under
`bash -c '…'`, or use the fish form given below each one.

- [ ] `.env` is gitignored (it is) and **has never been committed**:
      `git log --all --full-history -- .env` returns nothing
- [ ] the key itself has never been in any commit, on any branch:

      ```bash
      # bash
      git log -p --all -S"$(cut -d= -f2 <<<"$(grep FORTYGUARD_API_KEY .env)")" | head
      ```

      ```fish
      # fish
      git log -p --all -S(grep FORTYGUARD_API_KEY .env | cut -d= -f2) | head
      ```
- [ ] No key in `README.md`, in any doc, in any screenshot, or **in the demo video** — check
      the browser devtools panel if it was ever open on camera
- [ ] `frontend/.env.local` is gitignored (it is)
- [ ] The deployed backend's `ALLOWED_ORIGINS` names every origin judges will use

## 6.5 Credit budget

- [ ] Check the FortyGuard dashboard **before** judging opens and note the number
- [ ] Confirm the deployed backend's cache contains the Phoenix demo day, so the demo path
      is free
- [ ] Decide and document your live-fetch policy (§1.8)
- [ ] Check the dashboard **after** judging

One reminder from `README.md`: a season fetch is one heatmap per day at a flat 4,220 credits,
so 92 days is roughly **388,000** of a ~2,000,000 credit budget. The fetch is resumable and
checks the cache before every call. **Do not run it casually, and definitely not during
judging week.**

## 6.6 The 30-minutes-left path

If time runs out, this is the order that preserves the most value:

1. **Frontend deployed and green** — a judge who cannot open it scores nothing else.
2. **`docs/VALIDATION.json` current and committed** — the validation panel is your evidence.
3. **The video recorded**, even at 720p off localhost. A recording beats a broken live link.
4. **This document and `docs/LIMITATIONS.md` linked from the README.**
5. Everything else.

---

# Section 7 — Things found while writing this document

Collected here so none of it is buried in a subsection.

1. **The README's Cloud Run command would not have worked — now corrected.**
   `gcloud run deploy --source .` only auto-detects a Dockerfile in the source root; this
   one is at `backend/Dockerfile` and needs the repo root as context, so Cloud Build would
   fall through to buildpacks and fail. The README now carries the explicit build/push pair
   from [§1.3](#the-commands-that-do-work), and says why `--source` cannot be used.

2. **You have a second validation dataset, and it is better than the one you have.** Seven
   real ALDOT elements with published measurements *and* a published ConcreteWorks benchmark
   ([§2.2](#22--a-second-independent-dataset--and-satalites-actual-results-on-it)). SatAlite
   scores 5.4 °C MAE against ConcreteWorks' 4.9 °C. Nothing in the codebase has ever seen
   these elements.

3. **Free hourly historical weather with no API key exists and works** — Open-Meteo's
   archive, verified during this write-up, supplying exactly the five `AmbientSpec` arrays.
   This closes the biggest identified error source in `docs/LIMITATIONS.md` §8 (the inferred
   symmetric diurnal curve) for **every** validation case, and it is the wind and hourly-GHI
   source `docs/SPEC-00-MASTER.md` §4.6 already planned for.

4. **Time to peak is systematically late by a mean of 8.7 h**, all seven errors positive.
   This is a bias with a cause, not scatter. It is now written up as `docs/LIMITATIONS.md`
   §9, with the per-element table and the note that peak *temperature* on the same runs is
   not biased the same way — so the model gets roughly the right peak at roughly the wrong
   time.

5. **The core–surface differential was evaluated at the wrong point relative to ACI 301 —
   now fixed, and the fix was not enough.** `surface_temp_c` is the mean true free surface;
   the 35 °F limit is written against an embedded sensor. The solver now samples at
   `surface_probe_depth_m` (default 50 mm) and the cracking flag reads that. On thick
   sections it is worth only ~5 °C at 50 mm against a 24–36 °C gap, so the surface still
   runs far too cold and that is undiagnosed. On the 300 mm slab the season replay uses it
   is decisive: `pct_days_breaching_cracking` went from 100%/100% at 04:00/14:00 to
   **0%/50%** — a headline statistic that previously said nothing. `docs/LIMITATIONS.md` §10.

6. **`cement_type: "I/II"` was rejected with a 422 — now accepted at 505 J/g.** Type I/II
   is one of the commonest US cement designations and every Auburn element uses it, but
   `H_CEM_BY_TYPE` had only `I`, `II`, `II/V`, `V`, so every such mix had to be relabelled
   before it would solve at all. Placed between `I` (510) and `II` (500) the way `II/V`
   sits between its two, with the competing argument written down in the constant's own
   comment. The two candidate values differ by ~0.1 °C on peak core.

7. **A `fields=true` response is 3.93 MB against Vercel's 4.5 MB body cap** — 13% headroom on
   the shipped demo element, both figures decimal, and it scales with
   `width × thickness / dx²`. If you take Path B, do not demo a large section.

8. **On a read-only filesystem, a live FortyGuard fetch spends the credits and then crashes.**
   `cached_call` writes to disk *after* the API returns. On Vercel that is 4,220 credits gone
   and nothing kept. On Cloud Run it is fine.

9. **`POST /api/pour-windows` can be six solves in one request.** With the shipped demo
   ambient it degrades to one. Shorten the duration in the left panel and it becomes ~37 s.
   Set your platform timeout accordingly.

10. **Peak RSS measured at 285 MiB** (`VmHWM: 291,388 kB`) on the uvicorn worker, after four
    `POST /api/simulate` runs and one `?fields=true` run. That is inside Render's 512 MB but
    not comfortably — which is why Render fails on CPU first, and would fail on memory second
    if anyone asked it for an ensemble.

11. **The hackathon was postponed and the press coverage was not updated.** Articles still
    name 3–17 August 2026; the real window is 18–30 August. If you cite a date anywhere in
    the submission, cite 30 August.

12. **The Auburn report's authors were wrong in this document, and are now right.** It read
    "(Fannin, Barnes, Schindler et al.)". The title page is **Eric D. Gross, Andrew D.
    Eiland, Anton K. Schindler and Robert W. Barnes, December 2017**. There is no Fannin.
    This is the most-quoted citation in the submission and the one a judge is most likely to
    open.

13. **One ConcreteWorks accuracy class was wrong, in ConcreteWorks' disfavour.** Scottsboro
    Bent Cap's −5 °F was printed "Good"; Table 6-1's Excellent band is ±0–5 °F and the
    report's own prose confirms two Excellents. Corrected to **Excellent** in
    [§2.2.3](#223--what-satalite-actually-produced). Getting a benchmark wrong in your own
    favour is the one error a judge will not forgive.

14. **The report contradicts itself on Brewton and this document did not say so.** Table
    5-20 says Class F fly ash and Gravel; Appendix Table H-1 says Class C and #67 Limestone.
    The runs used F and limestone, which is the inconsistent pair. Now footnoted in
    [§2.2.1](#221-the-inputs-ready-to-type-into-the-studio).

15. **The report publishes measured cement chemistry for all seven elements and nothing in
    this repo can consume it.** Appendix Tables B-2…H-2 carry the full Bogue set and Blaine
    fineness. `MixSpec` has no chemistry field, so the runs used the generic constants in
    `physics/season_analysis.py`. On Albertville: tau 17.339 h assumed vs **16.341 h**
    measured, and `cement_heat_j_per_g` on the real Bogue compounds is **462.2 J/g** against
    the 510 used — 9.4% less heat. The two effects point opposite ways.
    [§2.2.6](#226--what-the-report-also-publishes-and-nothing-here-can-use).

16. **Two source links were dead.** ACI 306.1 (`ItemID=306110` → `306190`) and TxDOT
    0-4563-1 (`ctr.utexas.edu` → `library.ctr.utexas.edu`). A third, LTRC FR 584, could not
    be verified on any live host and has been replaced by a ROSAP mirror rather than left
    as an unchecked url.

17. **Section 0.2's byte counts were stale by exactly one field.** Both `simulate` rows grew
    by **8,126 bytes** — the `surface_probe_temp_c` array, 433 floats — between the draft and
    this commit. The table is re-measured; the old numbers dated it precisely.

---

*Every measured number in this document came from running this commit. Every external claim
carries a link, and every link was fetched on 2026-08-27. Where something could not be
verified — Reddit thread URLs, LTRC FR 584, the exact hackathon dates — it says so instead
of guessing.*
