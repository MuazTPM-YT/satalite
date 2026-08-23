# SatAlite — Master Build Specification

**FortyGuard Hackathon'26 · 18–30 Aug 2026 · Muaz, Razan, Krish**
**Repo:** https://github.com/MuazTPM-YT/satalite

This is the reference. Individual specs (01/02/03) are the actionable versions.
Where they disagree with this file, this file wins — raise it rather than guessing.

Legend: ⚠️ = unverified, verify before relying · 🔴 = known gap we disclose, not solve

---

# 1. WHAT WE ARE BUILDING

Concrete gains strength on **temperature × time**, not on the calendar. Cube tests cure
in a controlled 27 °C tank; the real element sits in 44 °C Phoenix sun or through a cold
night. Nobody records what the element itself experienced — that information evaporates
the moment the pour finishes.

SatAlite reconstructs it from hyperlocal hourly air temperature, runs it through
established concrete physics, and returns a **decision** (when to place) and a
**document** (what happened).

## 1.1 The name

Satellite + **alite** (C₃S, tricalcium silicate) — the cement phase with the highest heat
of hydration, 500 J/g in the Schindler–Folliard model. We are literally named after the
compound generating the heat we model.

## 1.2 What SatAlite is NOT

- **Not structural analysis.** No loads, no stress, no failure prediction. We never say
  "would break." We say "lowest strength gain", "exceeds DEF threshold", "exceeds
  cracking differential."
- **Not a replacement** for cube tests or in-situ verification before striking.
- **Not a spatial/portfolio product.** We measured this. It is not there (§3.2).
- **Not a 28-day strength predictor.** The crossover effect makes maturity unreliable
  beyond ~7 days equivalent age.

## 1.3 Users

| User | What they get |
|---|---|
| Site / planning engineer | When to place; when it will be strong enough |
| QC engineer | The Pour Record — an artifact that currently does not exist |
| RMC supplier | Evidence the mix met spec and placement conditions did not |

---

# 2. THE DECISION HISTORY (why the spec looks like this)

Read this before proposing changes — most obvious ideas were already tested and rejected.

| Decision | Reason |
|---|---|
| Temporal, not spatial | Measured: 0.033 °C spatial spread vs 7.48 °C diurnal swing. 75× |
| Phoenix, USA | API coverage is US-only |
| QC framing over scheduling | A practising engineer was lukewarm on scheduling, warmer on QC |
| Probabilistic output | Striking formwork is safety-critical; we support, never decide |
| 2D solve, 3D view | 2D is correct physics for prismatic elements; 3D is legibility |
| No CAD/IFC import | ~1 week of work for geometry the user can type in 4 fields |
| Shape library | What ConcreteWorks does. Covers ~95% of real elements |
| No database | Disk cache is enough for 13 days; removes deployment friction |

---

# 3. VERIFIED API FACTS (do not re-derive, we paid for these)

## 3.1 Behaviour

- Coverage **U.S.-only**. Non-US returns errors or empty.
- **Celsius everywhere** — tiles *and* thresholds. The client docstring claiming °F is
  **wrong**, verified against live Phoenix data.
- `cloud_cover_octas` is **PERCENT (0–100)** despite the field name. Use `CC/100`.
- **No wind field anywhere.** Confirmed by exhaustive key search.
- `solar_irradiance` is **daily-only** clear-sky GHI/DNI/DHI. No hourly.
- `create_heatmap()` returns `{"activity_id":…, "result":{…}}` — payload under `["result"]`.
- Auth is an `api-key` header, not Bearer.
- Async: submit → poll. Back off 3s → 6s → 12s.
- **Deterministic** — identical requests reproduce to 4 decimals. Caching is provably safe.
- Polygon: `[lon, lat]`, closed ring, ≤ ~130 km².
- Date range 2021-01-01 → present. **Forecast horizon 12 hours.**

## 3.2 Spatial variation — the negative result

| AOI | Area | sd(avg T) | range |
|---|---|---|---|
| Downtown | 2.52 km² | 0.033 °C | 0.099 °C |
| Mid | 15.95 km² | 0.041 °C | 0.127 °C |
| Large | 119.59 km² | 0.103 °C | 0.513 °C |

Elevation-controlled land-cover test (tarmac vs urban core, 6 m elevation apart):
**+0.10 °C daily, −0.08 °C at 15:00, +0.56 °C at 05:00.**

**This is correct physics, not a broken API.** `tcm` is 2 m *air* temperature. Daytime
convection homogenises the near-surface layer; at night the boundary layer decouples and
local UHI appears. Signal at 05:00, none at 15:00 — textbook behaviour.

By contrast a single tile swings **32.80 → 40.28 °C in one day**. Temporal variation is
**75× spatial**. That is the product.

## 3.3 Analytics

| Type | Returns | Units |
|---|---|---|
| `tcm` | per-tile `average/min/max_temperature` | °C |
| `time_of_measure` | hour of peak | ⚠️ returned 5.0 uniform, semantics unclear |
| `exceedance` | **count of hours** past threshold | hour (fractional) |
| `persistence` | longest unbroken run | hour |

🔴 `exceedance` is **NOT** degree-hours and **NOT** a maturity integral.

## 3.4 filter_type

| # | Meaning | Returns |
|---|---|---|
| 1 | Single hour | one scalar (avg = min = max) |
| 2 | Hour range | window aggregate, intervening hours discarded |
| 3 | **Single day** | **per-tile min, mean AND max** ← use this |
| 4 | Date range | heatmaps only |

**There is no way to get a time series in one call.** `filter_type=3` supplies the three
constraints diurnal reconstruction needs, at 1 call/day instead of 24.

## 3.5 Credits

- Flat **4220 per heatmap**, regardless of area/granularity/filter/analytic
- 2900 per `env_params`
- 2,000,000 total → **~474 heatmap calls, full stop**
- ⚠️ Dashboard shows a separate **"30 heatmaps/day"** limit. Scope unconfirmed — see M1.
- **Always granularity 100.** 60 returns identical values to 3 decimals. Pure waste.

### Budget

| Use | Calls | Credits |
|---|---|---|
| Season, daily, 92 days | 92 | 388k |
| Hourly validation, 3 days | 72 | 304k |
| Development | ~100 | 422k |
| Buffer | ~200 | ~840k |

---

# 4. PHYSICS

## 4.1 Governing equation — 2D masked FD

```
ρ·c_p·∂T/∂t = k·(∂²T/∂x² + ∂²T/∂y²) + Q̇(x,y,t)
α = k/(ρ·c_p)
```

Solved on the **cross-section**. Heat flow along the length is negligible for prismatic
elements. 1D is the degenerate case (one-cell-wide column).

## 4.2 Properties

| Symbol | Default | Range |
|---|---|---|
| ρ | 2400 kg/m³ | 2300–2500 |
| c_p | 1000 J/(kg·K) | 900–1100 |
| k | 2.2 W/(m·K) | 1.4–3.6 (aggregate) |
| α | ~9.2e-7 m²/s | 8e-7 – 1.2e-6 |

⚠️ `k` may vary with degree of hydration — **R4** confirms ConcreteWorks' treatment.

## 4.3 Hydration (Schindler & Folliard 2005)

```
α(t_e) = α_u · exp( −[τ / t_e]^β )

α_u    = 1.031·(w/cm) / (0.194 + w/cm)          Mills 1966
         ⚠️ SCM correction terms — R1 BLOCKING

H_u    = H_cem·p_cem + 461·p_slag + 1800·p_FA-CaO·p_FA      [J/g]
H_cem  = 500·p_C3S + 260·p_C2S + 866·p_C3A + 420·p_C4AF
         + 624·p_SO3 + 1186·p_FreeCaO + 850·p_MgO           [J/g]
         default 470 J/g if Bogue data unavailable

dα/dt_e = α_u · (β/t_e) · (τ/t_e)^β · exp(−(τ/t_e)^β)
dα/dt   = dα/dt_e · exp[−(E/R)(1/T − 1/T_r)]
Q̇       = H_u · C_c · dα/dt                                 [W/m³]
```

🔴 **Units trap:** `H_u` in **J/kg** (×1000 from J/g), `C_c` in kg/m³. A factor-1000 error
still produces a smooth plausible curve.

🔴 Floor `t_e` at 1e-6 h or `(τ/t_e)^β` overflows at t=0.

🔴 `Q̇` is computed **per cell** — the core is hotter, hydrates faster. That feedback is
the entire point of the coupling.

⚠️ τ, β regressions — **R2**.

## 4.4 Maturity

**Arrhenius (primary, ASTM C1074):**
```
t_e = Σ exp[−(E/R)(1/T − 1/T_r)]·Δt     T, T_r in KELVIN, R = 8.314
E   = 33500 J/mol            (T ≥ 20 °C)
E   = 33500 + 1470·(20 − T)  (T < 20 °C, T in °C in this expression only)
```
⚠️ `T_r` is a **choice** (20 °C or 23 °C) and must match the strength calibration. Config
value, never hardcoded silently. ⚠️ Schindler gives an alternative E — **R3**.

**Nurse–Saul (report alongside, not primary):**
```
M = Σ (T − T₀)·Δt      only when T > T₀      [°C·h]
```
T₀ = −10 °C per ASTM. ⚠️ One study suggests −3 °C. Treat as calibratable.

## 4.5 Strength–maturity

```
S(t_e) = S_u · exp( −[τ_s / t_e]^{β_s} )
```
🔴 **Cannot be derived from physics.** Requires ASTM C1074 lab calibration. We ship
literature defaults (**R5**) and allow upload. State this in the UI, not just the pitch.

Framing: *we replace the sensor, not the lab test.*

## 4.6 Boundary conditions

```
−k·∂T/∂n |_s = h_eff·(T_s − T_air) + q_rad_net − q_solar_abs + q_evap
1/h_eff = 1/h_conv+rad + Σ(L_i/k_i)
```

| Formwork | R [m²K/W] |
|---|---|
| Bare | 0 |
| Plywood 18 mm | ~0.15 |
| Steel | ~0 |
| Insulating blanket | 0.5–1.5 |

**Convection:** `h_c = 5.6 + 3.95·v` (v < 5 m/s); `h_c = 7.6·v^0.78` (v ≥ 5)

**Wind:** 🔴 not in FortyGuard. **Open-Meteo hourly** (explicitly permitted by the FAQ),
with optional user override — ACI 305.1 requires on-site wind monitoring, so user entry
is real practice. **Do not use a climatological constant:** wind has a diurnal cycle, and
a constant value erases the 4am-vs-2pm difference the product exists to evaluate.

**Radiation:** `h_r = ε·σ·(T_s² + T_sky²)(T_s + T_sky)`, ε ≈ 0.90, σ = 5.67e-8.
`T_sky` = `T_air − 6K` clear → `T_air` overcast, interpolated by cloud fraction.

**Solar (top face):** `q = a_s · GHI_hourly`, a_s ≈ 0.55. Daily clear-sky GHI × clear-sky
hourly shape, attenuated by **Kasten–Czeplak**: `GHI = GHI_clear·(1 − 0.75·(CC/100)^3.4)`
— note `/100`, cloud cover is percent.

**Faces are tagged individually:**

| Face | BC |
|---|---|
| Top exposed | convection + radiation + solar + evaporation |
| Formed | convection + radiation + formwork resistance |
| Against ground | semi-infinite soil sink ≈ annual mean temperature |
| Against existing concrete | ≈ adiabatic short-term |

## 4.7 Evaporation — Uno equation (ACI 305.1-14)

```
E = (Tc^2.5 − r·Ta^2.5)(1 + 0.4V) × 10⁻⁶      lb/ft²/h
    Tc, Ta in °F · V in mph · r = RH/100
q_evap = E · L_v ,  L_v ≈ 2.45e6 J/kg
```
Verified against the standard's worked example (90 °F, 100 °F, 0.56, 18 mph → 0.17).
**This replaced Menzel.** Trigger 0.2 lb/ft²/h, lower for blended cements (Type 1L).

## 4.8 Placement temperature — ACI 305 mixing equation

```
T = [0.22(T_a·M_a + T_c·M_c) + T_w·M_w + T_wa·M_wa]
    / [0.22(M_a + M_c) + M_w + M_wa]
```
🔴 **Largest single error source.** First-class input.

Aggregate is the dominant mass term and the stockpile sits outdoors for days — estimate
its temperature from a **multi-day ambient average at the site tile**. Non-obvious use of
the archive that ties accuracy to the hyperlocal data.

## 4.9 Numerics

- Δx = 5–10 mm. A 600×300 beam at 10 mm = 60×30 = 1800 cells.
- ⚠️ **2D explicit stability: `Δt ≤ Δx²/(4α)`, tighter with Robin BC — K1 BLOCKING.**
- Assert the limit at runtime. Wrong → silent garbage, not a crash.
- Surface cells use a **half-cell energy balance**, not a ghost node (**K4**).
- Assert energy conservation each step.
- Performance: ~2–5 s/run at 10 mm. MC ensemble at 20 mm, final run at 10 mm.

## 4.10 Geometry — shape library

Equivalent thickness fallback `t_eq = 2·V/A`:

| Shape | t_eq |
|---|---|
| Slab `t`, both faces | `t` |
| Slab on ground | `2t` |
| Square column `a` | `a/2` |
| Rect column `b×h` | `bh/(b+h)` |
| Beam `b×h`, 3 faces | `2bh/(b+2h)` |
| Cube `a` | `a/3` |

⚠️ V/A preserves average cooling but **underestimates peak core** — non-conservative for
DEF. Tier-1 results are screening-grade only. Prefer the 2D solve.

---

# 5. THRESHOLDS

| Check | Limit | ⚠️ verify |
|---|---|---|
| DEF | peak core > 70 °C | R6 — 70 or 65? |
| Thermal cracking | core−surface ΔT > 20 °C | R6 — 20 or 19.4 (35 °F)? |
| Placement temp | > 32 °C | R6 — ACI 305 |
| Evaporation | > 0.2 lb/ft²/h | Uno, §4.7 |
| Strip readiness | 70–75% f'c | R6 — ACI 347 |

Report all five independently — never collapse into one score. **Always display the code
calendar default alongside.** We accelerate; we do not override.

---

# 6. UNCERTAINTY

Monte Carlo, 500–2000 samples:

| Parameter | Spread |
|---|---|
| Placement temperature | ±3 °C |
| h_eff | ×0.5 – ×2.0 |
| τ, β | prior |
| a_s | 0.50–0.65 |
| k, ρc_p | ±15% |
| Forecast error | empirical — backtest FortyGuard's 12h forecast against its own later observations |

Output `P(f'c ≥ target)` **as a function of time**. User picks the confidence level.
Seed explicitly — demo must be reproducible.

---

# 7. UI

## 7.1 Page 1 — Simulator (the product)

Left panel, all sections **pre-populated with working defaults on load** — a judge sees a
running simulation in second one, never an empty form.

```
SITE     map pin, Phoenix polygon
ELEMENT  shape ▾ · dimensions · face roles · formwork ▾ · live section preview
MIX      grade ▾ · cement ▾ · content · w/cm · SCM % · (advanced: τ β H_u)
POUR     date · time · placement temp · wind [auto ▾]
```

Main canvas: **3D extruded element** (default view) with

- Layer toggle: **Maturity/Strength · Temperature · Gradient** (three layers, never one
  blended "weakness" score — the core is simultaneously highest maturity and highest DEF
  risk; one scale cannot say both)
- Time scrubber 0 → 72 h ← **the demo moment**
- **Clip plane slider** ← the money shot: slice the block open, red core inside blue shell
- Click-to-probe: temperature, maturity, equivalent age, strength at that point, at that time
- Permanent label: *"2D cross-section solution, extruded. End effects not modelled."*

Below: core/surface curves · strength curve with band · the five threshold flags ·
strip-ready time at chosen confidence.

**Keep the flat 2D section view too.** 3D sells; 2D is what an engineer reads numbers off.

## 7.2 Pour window strip

| Start | Peak core | ΔT | Evap | Strip-ready |
|---|---|---|---|---|
| 04:00 | 58 °C ✅ | 14 ✅ | 0.11 ✅ | 62 h |
| 14:00 | 71 °C 🔴 | 24 🔴 | 0.31 🔴 | **51 h** |

**The 14:00 row must show the shortest strip time.** Fastest is also worst — that
trade-off is the most persuasive thing on screen. Never hide it behind a single score.

## 7.3 Page 2 — Season analysis

One chart, one number, computed offline. *"Across summer 2025 in Phoenix, X% of days
would breach the DEF threshold at 2 pm placement. At 4 am, Y%."*

🔴 **Fix the standard element before running. Do not tune it afterwards to inflate the
number.** A small honest number beats a large questionable one.

## 7.4 Pour Record (PDF)

Element ID · tile coords · mix · formwork · pour time · hourly ambient history ·
modelled core/surface curves · all five checks · maturity (both formulations) · strength
curve with band · model version, parameters, data source, timestamp · scope banner:
*planning and QA support — not a substitute for in-situ verification prior to striking.*

---

# 8. ARCHITECTURE

```
satalite/
├── backend/
│   ├── app/          FastAPI — main, config, api/routes, models, services
│   ├── physics/      PURE numpy. imports NOTHING from app/ or fastapi. EVER.
│   ├── vendor/fortyguard/
│   ├── data/cache/
│   └── tests/        test_golden, test_purity, test_api
├── frontend/         Next.js + TS + Tailwind + three/r3f
└── docs/             BUILD_SPEC, DIAGNOSTICS, VALIDATION
```

`physics/` purity is **architectural, enforced by `test_purity.py`**. It exists so the
science can be tested and reviewed in isolation from the web layer. Do not weaken it.

## 8.1 Endpoints

```
POST /api/simulate        element + mix + conditions → curves + field
POST /api/pour-windows    rank candidate start hours
GET  /api/elements/{id}/record   pour record JSON + PDF
POST /api/season-analysis  async job → exposure statistic
GET  /api/health
```

Stubs raise `NotImplementedError`. **Never return fabricated data** — a stub silently
returning zeros is worse than one that crashes.

---

# 9. TESTING

## 9.1 Golden tests (must pass before any UI shows real output)

1. **Adiabatic** — h=0, no losses. Rise → `H_u·C_c·α_u/(ρ·c_p)` ≈ 52 °C for 400 kg/m³,
   H_u 450 J/g, α_u 0.7. Cross-check: 12–14 °C per 100 kg/m³ cement → 48–56 °C.
2. **No hydration** — Q=0. Decays to ambient, matches analytical solution (**K3**).
3. **Constant temperature** — Nurse–Saul returns exactly `(T−T₀)·t`; Arrhenius at
   `T = T_r` returns exactly `t`.
4. **Energy balance** — every step, generated = stored + lost through all faces.
5. **Grid convergence** — halving Δx changes peak core < 0.1 °C.
6. **Purity** — AST walk of `physics/`, no fastapi/pydantic/app imports.

## 9.2 Validation

- Cavadia dataset (Zenodo 10.5281/zenodo.14205913) — **conduction half only**; monitoring
  began 38 days post-cast so there is no hydration heat.
- ConcreteWorks benchmark on identical inputs.
- State the ceiling honestly: **no real instrumented pour paired with this API exists
  anywhere.**

---

# 10. 🔴 WHAT WE DO NOT MODEL — disclose, don't hide

| # | Gap |
|---|---|
| F1 | **Elastic modulus lags strength** → early stripping can deflect even at correct strength. **R7.** |
| F2 | Thermal *stress*. We give ΔT, not stress. |
| F3 | Zero-stress temperature — stress accumulates only after set. |
| F4 | Autogenous/drying shrinkage, creep. |
| F5 | Crossover effect on 28-day strength. We predict 1–7 days only. |
| F6 | Curing adequacy. Maturity assumes hydration-permitting moisture. A slab drying out in Phoenix sun stops gaining strength while the model keeps integrating. |
| F7 | End effects / true 3D. 2D cross-section extruded. |
| F8 | Reinforcement thermal mass. |
| F9 | Wind from FortyGuard (using Open-Meteo). |
| F10 | Formwork also cures surfaces; stripping early needs alternative curing. |

---

# 11. PRIOR ART — cite, differentiate, never pretend

| Product | What it does | Our difference |
|---|---|---|
| **PourDay** (free) | ACI 305R evaporation rate from live weather, 16-day forecast, GO/CAUTION/NO-GO, pour log | Surface plastic-shrinkage at placement. We model interior thermal history, maturity, strength, DEF, cracking over days |
| Giatec (SmartRock/Roxi/SmartMix) | Embedded sensors; ML on 300k+ mixes | Sensor-based, post-pour. Do **not** claim a data advantage |
| Converge (Signal/Predict) | Sensor + AI forecast; targets mix selection | Sensor-anchored |
| ConcreteWorks / HIPERPAV | Same physics lineage, free desktop | Generic weather input, single element, no live forecast, no learning |
| arXiv 2602.16748 (2026) | Digital twin, early-age strength for QA | Very close framing — cite it |

---

# 12. JUDGING

**Two stages: the FortyGuard team screens all submissions to a top 10, then judges score
those.** Stage 1 is FortyGuard staff — the video and 500-word description must make the
project legible in ~2 minutes or we never reach the judges.

| Weight | Criterion |
|---|---|
| 40% | Impact & Relevance |
| 35% | Technical Execution |
| 15% | Innovation |
| 10% | Communication |

Their stated bar: *real use of the platform, a clear problem and user, a measurable
before-and-after outcome, and a credible path to real-world deployment. Applied relevance
over flashy demos.*

**No civil or structural engineer among the judges** — NVIDIA AI, sustainability, Google
Cloud/VC, smart-cities futurist, FortyGuard CEO, VC. The dominant communication risk is
**not** surviving a technical grilling; it is the audience not grasping why concrete
curing matters at all. Domain rigour is a *credibility signal*, not something that will be
interrogated deeply — but FortyGuard's ML lead and engineers screen first, so don't get
sloppy.

## Submission (30 Aug, 23:59 GST — hard cutoff)

1. Live demo link
2. Video, max 3 minutes
3. GitHub with `Hackathon-FG` as collaborator ✅ done
4. Description, max 500 words

---

# 13. TIMELINE

| Days | Focus | Gate |
|---|---|---|
| **18–19** | Scaffold. Research R1–R3, K1–K2, M1 return. Season fetch starts. Deploy hello-world. | Blocking research in |
| **20–22** | Physics core + golden tests passing. Frontend shell. 3D viewer on **synthetic** field. | All golden tests green |
| **23–25** | Integration. Real solver into viewer. Pour window. Clip plane, probe. | End-to-end works |
| **26–27** | Pour Record PDF. Season analysis. Uncertainty bands. Polish. | Feature freeze 27th |
| **28–29** | **No new features.** Video, write-up, demo dataset frozen, deploy verified. | Rehearsed |
| **30** | Buffer. **Submit early, not at 23:00.** | Submitted |

🔴 **Feature freeze end of day 27.** The last 48 hours buy the 10% you cannot recover any
other way.

---

# 14. OPEN ITEMS

| # | Question | Owner | Blocking |
|---|---|---|---|
| R1 | Schindler SCM coefficients for α_u | Razan | 🔴 yes |
| R2 | τ, β regressions | Razan | medium |
| R3 | Activation energy formulation | Razan | 🔴 yes |
| R4 | ConcreteWorks default properties | Razan | medium |
| R5 | Strength–maturity defaults, US grades | Razan | medium |
| R6 | Threshold values with sources | Razan | 🔴 yes |
| R7 | Modulus lag answer | Razan | medium |
| R8 | Real pour record examples | Razan | low |
| R9 | Non-expert 60s explanation + SCM/carbon angle | Razan | 🔴 yes |
| K1 | 2D stability with Robin BC | Krish | 🔴 yes |
| K2 | Independent check of golden test 1 | Krish | 🔴 yes |
| K3 | Analytical solution for test 2 | Krish | medium |
| K4 | Surface node energy balance | Krish | 🔴 yes |
| M1 | Does 30/day apply to the API? | Muaz | 🔴 yes |
| M2 | `time_of_measure` semantics | Muaz | low |
| M3 | Mentor session — Jordana Rosa (Autodesk) | Muaz | time-sensitive |
| M4 | Deploy target live | Muaz | 🔴 yes |
