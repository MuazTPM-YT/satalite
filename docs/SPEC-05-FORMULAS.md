# SatAlite — Complete Formula Reference

Every equation in the system, in execution order. Variables and units for each, plus
what/where/why/when.

⚠️ = needs confirmation · 🔴 = a trap that produces plausible but wrong numbers

---

# THE FLOW

```
PHASE 1  INPUTS          ┌─ FortyGuard: daily Tmin/Tmean/Tmax ─┐
                         │  Open-Meteo: hourly wind            │
                         │  env_params: RH, cloud, solar       │
                         └────────────┬────────────────────────┘
                                      ↓
                         [1] reconstruct hourly ambient
                         [2–4] solar geometry
                         [5] placement temperature

PHASE 2  MATERIAL        [6–12] mix chemistry → hydration parameters
         (once per mix)          α_u, H_u, τ, β, α (diffusivity)

PHASE 3  GEOMETRY        [13–14] rasterise cross-section, tag faces

PHASE 4  BOUNDARY        [15–22] per face, per timestep:
         (per timestep)          h_conv, h_rad, h_eff, solar, evaporation

PHASE 5  COUPLED SOLVE   ┌──────── LOOP over timesteps ────────┐
         (the core)      │ [23] Arrhenius rate multiplier      │
                         │ [24] equivalent age                 │
                         │ [25] degree of hydration            │
                         │ [26] rate of hydration              │
                         │ [27] volumetric heat generation     │
                         │ [28] interior node update           │
                         │ [29] surface node update            │
                         │ [30] stability assert               │
                         └─────────────────────────────────────┘
                                      ↓
PHASE 6  OUTPUTS         [31–36] maturity, strength, modulus,
                                 gradient, flags

PHASE 7  UNCERTAINTY     [37] Monte Carlo → P(f'c ≥ target | t)
```

**Why this order:** each phase consumes only what earlier phases produced. Phase 2 runs
once per mix; phases 4–5 run every timestep; phase 7 wraps the whole thing 500–2000 times.

---

# PHASE 1 — INPUTS

## 1) Diurnal Temperature Reconstruction (Parton–Logan)

```
DAY    T(t) = T_min + (T_max − T_min) · sin( π·(t − t_sr) / (D + 2a) )
NIGHT  T(t) = T_min + (T_ss − T_min) · exp( −b·n / (24 − D) )
```

| | |
|---|---|
| `T(t)` | air temperature at hour t **(°C)** |
| `T_min`, `T_max` | daily minimum / maximum from `tcm` **(°C)** |
| `t` | hour of day **(h)** |
| `t_sr` | sunrise hour **(h)** |
| `D` | daylength **(h)** |
| `T_ss` | temperature at sunset **(°C)** |
| `n` | hours since sunset **(h)** |
| `a` | daytime lag parameter ≈ **1.86 (dimensionless)** |
| `b` | nocturnal decay coefficient ≈ **2.20 (dimensionless)** |

**Where:** `services/diurnal.py` · **When:** once per pour day, before the solve.
**Why:** the API gives daily min/mean/max in one call; true hourly costs 24 calls. This
turns 1 call into 24 hours of data — a **24× credit saving**, which is what makes the
92-day season analysis affordable at all.
**How:** rescale the reconstructed curve so its mean equals the API's `T_mean`. Most
implementations only have min/max; we have mean too, so use it as a third constraint.

---

## 2) Solar Declination

```
δ = 23.45° · sin( 360° · (284 + n) / 365 )
```

| | |
|---|---|
| `δ` | solar declination **(degrees)** |
| `n` | day of year, 1–365 **(dimensionless)** |

## 3) Sunset Hour Angle & Daylength

```
cos(ω_s) = −tan(φ) · tan(δ)
D        = (2/15) · ω_s
t_sr     = 12 − D/2
```

| | |
|---|---|
| `ω_s` | sunset hour angle **(degrees)** |
| `φ` | site latitude **(degrees)** — 33.455° for Phoenix |
| `D` | daylength **(hours)** |
| `t_sr` | sunrise hour, local solar time **(h)** |

## 4) Hourly Clear-Sky Solar Shape

```
GHI_peak = (π/2) · GHI_daily
GHI(t)   = GHI_peak · sin( π·(t − t_sr) / D )        for t_sr ≤ t ≤ t_sr + D
GHI(t)   = 0                                          otherwise
```

| | |
|---|---|
| `GHI(t)` | global horizontal irradiance at hour t **(W/m²)** |
| `GHI_daily` | daytime-average clear-sky GHI from `env_params` **(W/m²)** |

**Where:** `physics/boundary.py` · **When:** every daylight timestep.
**Why:** the API returns solar only as a **daily** value (577.11 W/m² for Phoenix in July).
Solar gain on the top face can add 5–10 °C, so we need it hourly. A half-sine has mean
`2/π` of its peak, hence the `π/2` factor to preserve the daily average.
**Why it matters for the product:** solar is the single largest difference between a 2 pm
and a 4 am pour beyond air temperature alone.

---

## 5) Placement Temperature (ACI 305 Mixing Equation)

```
             0.22·(T_a·M_a + T_c·M_c) + T_w·M_w + T_wa·M_wa
T_placement = ───────────────────────────────────────────────
                  0.22·(M_a + M_c) + M_w + M_wa
```

| | |
|---|---|
| `T_placement` | fresh concrete temperature at placement **(°C)** |
| `T_a`, `M_a` | aggregate temperature **(°C)**, mass **(kg/m³)** |
| `T_c`, `M_c` | cement temperature **(°C)**, mass **(kg/m³)** |
| `T_w`, `M_w` | added water temperature **(°C)**, mass **(kg/m³)** |
| `T_wa`, `M_wa` | free moisture on aggregate **(°C)**, mass **(kg/m³)** |
| `0.22` | ratio of specific heat of solids to water ≈ 0.92/4.18 **(dimensionless)** |

**Where:** `services/placement.py` · **When:** once, sets the initial condition.
**Why:** 🔴 **This is the single largest error source in the whole model.** A ±3 °C error
here propagates through the entire cure.
**How — and this is the clever bit:** aggregate is the dominant mass term, and the
stockpile has been sitting outdoors for days. Estimate `T_a` from a **multi-day ambient
average at the site's own tile** from FortyGuard's archive. That's a non-obvious use of
the historical data that ties model accuracy directly to the hyperlocal source.

---

# PHASE 2 — MATERIAL PARAMETERS (once per mix)

## 6) Thermal Diffusivity

```
α = k / (ρ · c_p)
```

| | |
|---|---|
| `α` | thermal diffusivity **(m²/s)** — default 9.2e-7 |
| `k` | thermal conductivity **(W/(m·K))** — default 2.2, range 1.4–3.6 |
| `ρ` | density **(kg/m³)** — default 2400 |
| `c_p` | specific heat **(J/(kg·K))** — default 1000 |

**Why:** controls how fast heat spreads, and therefore sets the stability limit [30] and
the core-to-surface gradient [35].

---

## 7) Ultimate Degree of Hydration ✅ verified

```
α_u = 1.031·(w/cm) / (0.194 + w/cm) + 0.50·p_FA + 0.30·p_slag        ≤ 1.09
```

| | |
|---|---|
| `α_u` | ultimate degree of hydration **(dimensionless, 0–1.09)** |
| `w/cm` | water-to-cementitious ratio **(dimensionless)** |
| `p_FA` | fly ash fraction of total cementitious **(dimensionless)** |
| `p_slag` | GGBF slag fraction of total cementitious **(dimensionless)** |

**Source:** Schindler & Folliard (2005), regression on 352 response variables.
**Why:** hydration never completes — at w/cm 0.45 only ~72% of cement ever reacts. Caps
total heat released, so it directly sets peak core temperature.
🔴 **Both SCM terms are POSITIVE.** Do not sign-flip the slag term.

---

## 8) Cement Heat of Hydration (Bogue Compounds)

```
H_cem = 500·p_C3S + 260·p_C2S + 866·p_C3A + 420·p_C4AF
      + 624·p_SO3 + 1186·p_FreeCaO + 850·p_MgO
```

| | |
|---|---|
| `H_cem` | heat of hydration of the cement **(J/g)** — typically 450–500 |
| `p_C3S` | alite fraction **(dimensionless)** ← *this is what we're named after* |
| `p_C2S`, `p_C3A`, `p_C4AF` | belite, aluminate, ferrite fractions **(dimensionless)** |
| `p_SO3`, `p_FreeCaO`, `p_MgO` | sulfate, free lime, magnesia fractions **(dimensionless)** |

**When:** only if Bogue data available; otherwise default `H_cem = 470 J/g`.
**Why C₃S dominates:** its coefficient (500) is the largest and its fraction is the biggest
(~55%), so alite contributes roughly half the total heat.

## 9) Blended Ultimate Heat

```
H_u = H_cem·p_cem + 461·p_slag + 1800·p_FA-CaO·p_FA          (J/g)
```

| | |
|---|---|
| `H_u` | ultimate heat of the full binder **(J/g)** |
| `p_cem` | Portland cement fraction of binder **(dimensionless)** |
| `p_FA-CaO` | CaO fraction **within the fly ash** **(dimensionless)** |

🔴 **Convert to J/kg (×1000) before [27].** A factor-1000 error still produces a smooth,
entirely plausible curve — this is the easiest way to ship confidently wrong output.

---

## 10) Hydration Time Parameter ✅ verified numerically

```
τ = 66.78 · p_C3A^(−0.154) · p_C3S^(−0.401) · Blaine^(−0.804) · p_SO3^(−0.758)
        · exp( 2.187·p_slag + 9.50·p_FA·p_FA-CaO )
```

| | |
|---|---|
| `τ` | hydration time parameter **(hours)** — typically 10–20 |
| `Blaine` | cement specific surface area **(m²/kg)** — typically 350–400 |

**Verified:** Type I/II (p_C3A 0.08, p_C3S 0.55, Blaine 380, p_SO3 0.03) → **τ = 15.1 h.**
Lands in the expected band, which confirms the units convention.
**Physical meaning:** roughly *when* the hydration reaction peaks. Slag and fly ash both
push it later (positive exponential terms).

## 11) ⚠️ Hydration Shape Parameter — DISPUTED

```
β = 181.4 · p_C3A^(0.146) · p_C3S^(0.227) · Blaine^(−0.535) · p_SO3^(−0.558)
        · exp( −0.647·p_slag )
```

| | |
|---|---|
| `β` | hydration slope parameter **(dimensionless)** — should be ~0.7–1.2 |

⚠️ **As transcribed this gives β ≈ 32, which is impossible.** An independent calibration
reports β = 0.884. Flipping the `p_SO3` exponent to **+0.558** gives ≈ 0.65 — plausible.
**Use β = 0.9 fixed** until the sign is confirmed against the primary paper.

## 12) Biot Number

```
Bi = h_eff · Δx / k
```

| | |
|---|---|
| `Bi` | grid Biot number **(dimensionless)** |
| `Δx` | grid spacing **(m)** — 0.01 |
| `h_eff` | effective surface transfer coefficient **(W/(m²·K))** |

**Why:** appears in both surface-node stability [30] and the surface update [29]. Also
tells you whether a lumped model would have been valid — for our slabs it isn't, which is
why we solve 2D.

---

# PHASE 3 — GEOMETRY

## 13) Equivalent Thickness (fallback only)

```
L_c  = V / A_exposed
t_eq = 2 · L_c
```

| | |
|---|---|
| `L_c` | characteristic length **(m)** |
| `V` | element volume **(m³)** |
| `A_exposed` | total heat-losing surface area **(m²)** |
| `t_eq` | equivalent slab thickness **(m)** |

| Shape | t_eq |
|---|---|
| Slab `t`, both faces | `t` |
| Slab on ground | `2t` |
| Square column side `a` | `a/2` |
| Rect column `b×h` | `bh/(b+h)` |
| Beam `b×h`, 3 faces | `2bh/(b+2h)` |
| Cube side `a` | `a/3` |

⚠️ Preserves *average* cooling but **underestimates peak core** — non-conservative for DEF.
Screening-grade only. Prefer the real 2D solve.

## 14) Grid Convergence Check

```
| T_peak(Δx) − T_peak(Δx/2) | < 0.1 °C
```
**When:** golden test 5. **Why:** proves the answer is a property of the physics, not of
the mesh.

---

# PHASE 4 — BOUNDARY CONDITIONS (every timestep, per face)

## 15) Convective Coefficient

```
h_c = 5.6 + 3.95·v            (v < 5 m/s)
h_c = 7.6 · v^0.78            (v ≥ 5 m/s)
```

| | |
|---|---|
| `h_c` | convective heat transfer coefficient **(W/(m²·K))** |
| `v` | wind speed at the surface **(m/s)** |

**Where:** wind comes from **Open-Meteo** (FortyGuard has none), user-overridable — ACI
305.1 requires on-site wind monitoring, so user entry is real practice.
🔴 **Never use a climatological constant.** Wind has a diurnal cycle; a fixed value erases
the 4 am vs 2 pm difference the product exists to evaluate.

## 16) Sky Temperature

```
T_sky = T_air − 6·(1 − CC/100)            (K)
```

| | |
|---|---|
| `T_sky` | effective sky radiant temperature **(K)** |
| `CC` | cloud cover **(percent, 0–100)** |

🔴 The API field is named `cloud_cover_octas` but the values are **PERCENT**. Verified
against live data (min 0, max 100). Divide by 100, never by 8.

## 17) Radiative Coefficient

```
h_r = ε · σ · (T_s² + T_sky²) · (T_s + T_sky)
```

| | |
|---|---|
| `h_r` | radiative heat transfer coefficient **(W/(m²·K))** |
| `ε` | surface emissivity **(dimensionless)** — 0.90 for concrete |
| `σ` | Stefan–Boltzmann constant **5.67e-8 (W/(m²·K⁴))** |
| `T_s`, `T_sky` | surface and sky temperature **(K)** |

🔴 **Kelvin only.** Using °C here gives nonsense silently.

## 18) Effective Transfer Coefficient (series resistance)

```
1/h_eff = 1/(h_c + h_r) + Σ (L_i / k_i)
```

| | |
|---|---|
| `h_eff` | combined surface coefficient **(W/(m²·K))** |
| `L_i` | thickness of formwork layer i **(m)** |
| `k_i` | conductivity of layer i **(W/(m·K))** |

| Formwork | R = L/k **(m²·K/W)** |
|---|---|
| Bare | 0 |
| Plywood 18 mm (k ≈ 0.12) | 0.15 |
| Steel | ≈ 0 |
| Insulating blanket | 0.5–1.5 |

**Why it's a product feature:** *"switch to insulated blankets and you strip 7 hours
earlier"* is a real, actionable recommendation the tool can make.

## 19) Cloud Attenuation (Kasten–Czeplak)

```
GHI_actual = GHI_clear · ( 1 − 0.75·(CC/100)^3.4 )
```

| | |
|---|---|
| `GHI_actual` | cloud-adjusted irradiance **(W/m²)** |

## 20) Absorbed Solar Flux

```
q_solar = a_s · GHI_actual
```

| | |
|---|---|
| `q_solar` | absorbed solar flux **(W/m²)** |
| `a_s` | solar absorptivity **(dimensionless)** — 0.55 for fresh concrete, range 0.50–0.65 |

**Applies to the top exposed face only.**

## 21) Evaporation Rate — Uno Equation (ACI 305.1-14) ✅ verified

```
E = ( T_c^2.5 − r·T_a^2.5 ) · ( 1 + 0.4·V ) × 10⁻⁶
```

| | |
|---|---|
| `E` | surface evaporation rate **(lb/ft²/h)** |
| `T_c` | concrete surface temperature **(°F)** |
| `T_a` | air temperature **(°F)** |
| `r` | relative humidity as a fraction = RH/100 **(dimensionless)** |
| `V` | wind speed **(mph)** |

🔴 **This equation is in °F and mph while everything else is °C and m/s.** Convert at the
boundary and put the unit in the variable name.
**Verified** against the standard's worked example: 90 °F, 100 °F, 0.56, 18 mph → 0.17
lb/ft²/h. ✅
**Threshold:** 0.2 lb/ft²/h triggers plastic-shrinkage precautions; lower for blended
cements like Type 1L. **This replaced the older Menzel formula.**

## 22) Evaporative Heat Flux

```
q_evap = E' · L_v
```

| | |
|---|---|
| `q_evap` | latent heat flux **(W/m²)** |
| `E'` | evaporation rate converted to **(kg/(m²·s))** |
| `L_v` | latent heat of vaporisation **2.45e6 (J/kg)** |

Conversion: `1 lb/ft²/h = 1.3562e-3 kg/(m²·s)`

---

# PHASE 5 — THE COUPLED SOLVE (the core loop)

## 23) Arrhenius Rate Multiplier

```
k_arr = exp[ −(E_a/R) · (1/T − 1/T_ref) ]

E_a = 33500                     (T ≥ 20 °C)
E_a = 33500 + 1470·(20 − T_°C)  (T < 20 °C)
```

| | |
|---|---|
| `k_arr` | rate multiplier relative to reference **(dimensionless)** |
| `E_a` | apparent activation energy **(J/mol)** — default 33,500 |
| `R` | universal gas constant **8.314 (J/(mol·K))** |
| `T`, `T_ref` | node and reference temperature **(K)** |

🔴 **Kelvin inside the exponential. Celsius ONLY inside the `1470·(20 − T)` branch.**
⚠️ `T_ref` is a choice (20 °C or 23 °C) and **must match the strength calibration**.
Config value, never hardcoded.
⚠️ Independent calibrations report E_a up to 40,150 J/mol — include it in the Monte Carlo
over 33,000–42,000.

## 24) Equivalent Age (ASTM C1074)

```
t_e = Σ k_arr · Δt
```

| | |
|---|---|
| `t_e` | equivalent age at reference temperature **(hours)** |
| `Δt` | timestep **(hours)** |

**This is the heart of the whole product.** It converts a messy real thermal history into a
single number that predicts strength. Computed **per cell** — the core and surface have
different equivalent ages.

## 25) Degree of Hydration

```
α(t_e) = α_u · exp( −[ τ / t_e ]^β )
```

| | |
|---|---|
| `α` | degree of hydration **(dimensionless, 0 → α_u)** |

🔴 Floor `t_e` at 1e-6 h or `(τ/t_e)^β` overflows at t = 0.

## 26) Rate of Hydration

```
dα/dt_e = α_u · (β/t_e) · (τ/t_e)^β · exp( −(τ/t_e)^β )
dα/dt   = dα/dt_e · k_arr
```

| | |
|---|---|
| `dα/dt` | hydration rate in real time **(1/h)** |

**The coupling:** hot cells hydrate faster → generate more heat → get hotter. That positive
feedback is why you cannot just add a fixed offset to air temperature.

## 27) Volumetric Heat Generation

```
Q̇ = H_u · C_c · (dα/dt)
```

| | |
|---|---|
| `Q̇` | volumetric heat generation **(W/m³)** |
| `H_u` | ultimate heat **(J/kg)** ← not J/g |
| `C_c` | cementitious content **(kg/m³)** — typically 300–450 |

🔴 Computed **per cell**, every step. `dα/dt` must be in **1/s** here, not 1/h.

## 28) Interior Node Update (2D explicit FD)

```
T_ij^{n+1} = T_ij^n + Fo·( T_{i+1,j} + T_{i−1,j} + T_{i,j+1} + T_{i,j−1} − 4·T_ij^n )
                    + Q̇_ij·Δt / (ρ·c_p)

Fo = α·Δt / Δx²
```

| | |
|---|---|
| `Fo` | grid Fourier number **(dimensionless)** |
| `Δt` | timestep **(s)** |

## 29) Surface Node Update (half-cell energy balance) ✅ derived

```
T_s^{n+1} = T_s^n
          + 2·Fo·( T_in − T_s^n )                        ← normal conduction
          + Fo·( T_up + T_dn − 2·T_s^n )                 ← lateral conduction
          + 2·Fo·Bi·( T_air − T_s^n )                    ← convection
          + 2·Fo·( q_solar − q_evap − q_rad )·Δx / k     ← other surface fluxes
          + Q̇_s·Δt / (ρ·c_p)                             ← hydration
```

🔴 **Note the factor of 2** on normal conduction and convection — it comes from the
half-cell volume. A ghost-node formulation misses it and gives a **2× flux error at every
surface**, which silently shifts peak core temperature.

**Self-check:** collecting the `T_s^n` terms gives `1 − 2·Fo·(2 + Bi)`, which reproduces
the surface stability criterion in [30] independently. If your derivation doesn't do that,
something is wrong.

## 30) Stability Criteria ✅ derived

```
Interior             Fo ≤ 1/4
Plane surface        Fo ≤ 1 / [ 2·(2 + Bi) ]
Exterior corner      Fo ≤ 1 / [ 4·(1 + Bi) ]
```

**Worked, Δx = 10 mm, α = 9.2e-7, k = 2.2:**

| h_eff | Bi | Governing Δt |
|---|---|---|
| 10 W/m²K (still air) | 0.045 | 26 s |
| 50 W/m²K (windy) | 0.227 | 22 s |

**Use Δt = 10 s** — about 0.4× the tightest limit.
🔴 **Assert at runtime, every run.** Exceeding this produces silent garbage, not a crash.

---

# PHASE 6 — OUTPUTS

## 31) Nurse–Saul Maturity (report alongside, not primary)

```
M = Σ (T − T_0)·Δt          only when T > T_0
```

| | |
|---|---|
| `M` | maturity index **(°C·hours)** |
| `T_0` | datum temperature **(°C)** — ASTM default −10 |

⚠️ Linear, so biased when temperatures stray far from datum. Arrhenius [24] is primary.

## 32) Strength–Maturity Relationship

```
S(t_e) = S_u · exp( −[ τ_s / t_e ]^{β_s} )
```

| | |
|---|---|
| `S` | compressive strength **(MPa)** |
| `S_u` | limiting strength **(MPa)** |
| `τ_s` | strength time parameter **(hours)** |
| `β_s` | strength shape parameter **(dimensionless)** |

🔴 **Cannot be derived from physics.** Requires ASTM C1074 lab calibration per mix. We ship
literature defaults and allow upload. **Say this in the UI, not just the pitch.**
Framing: *we replace the sensor, not the lab test.*

## 33) Strength Evolution (fib Model Code 2010)

```
f_c(t) = f_c,28 · exp[ s·( 1 − √(28/t) ) ]
```

| | |
|---|---|
| `f_c(t)` | strength at age t **(MPa)** |
| `f_c,28` | 28-day strength **(MPa)** |
| `t` | age **(days)** |
| `s` | cement-type parameter **(dimensionless)** |

**When:** feeds [34] only. Do **not** use as the primary strength path — it's calendar-
based, which is exactly what we exist to replace.

## 34) Elastic Modulus (fib Model Code 2010)

```
E_28 = 21.5 GPa · α_E · ( f_c,28 / 10 MPa )^0.3
```

| | |
|---|---|
| `E_28` | 28-day Young's modulus **(GPa)** |
| `α_E` | aggregate stiffness factor **(dimensionless)** — 1.0 for quartz *and* limestone |

**Why we added this:** it answers the deflection objection. Modulus tracks strength
closely, so we can display an estimated E(t) beside strength.
🔴 **The real deflection risk is CREEP, not stiffness.** Early-loaded concrete is
significantly more creep-active even when strength and stiffness look mature. We do not
model creep — disclose it.

## 35) Core–Surface Differential

```
ΔT = T_core − T_surface
```
**Flag if ΔT > 20 °C** (thermal cracking risk). ⚠️ Confirm whether the spec figure is
20 °C or 19.4 °C (35 °F).

## 36) Adiabatic Temperature Rise (golden test 1)

```
ΔT_ad = H_u · C_c · α_u / (ρ · c_p)
```

**Check:** 400 kg/m³, H_u 450 J/g, α_u 0.7 → **52 °C.**
**Cross-check:** field rule of thumb of 12–14 °C per 100 kg/m³ of cement → 48–56 °C. ✅

**Why this is the most important test in the suite:** it validates [7], [9], [25], [27] and
the units conversion all at once, against a number an experienced engineer can eyeball.

---

# PHASE 7 — UNCERTAINTY

## 37) Probabilistic Strength

```
P( f'c ≥ f_target | t ) = (1/N) · Σ_i  1[ S_i(t) ≥ f_target ]
```

| | |
|---|---|
| `N` | Monte Carlo sample count **(dimensionless)** — 500–2000 |
| `S_i(t)` | strength from sample i **(MPa)** |
| `1[·]` | indicator function **(0 or 1)** |

**Sampled parameters:**

| Parameter | Distribution |
|---|---|
| `T_placement` | ±3 °C |
| `h_eff` | ×0.5 to ×2.0 (wind unknown) |
| `τ`, `β` | prior |
| `a_s` | 0.50–0.65 |
| `k`, `ρc_p` | ±15% |
| `E_a` | 33,000–42,000 J/mol |
| Forecast error | empirical, by lead time |

**Why probabilistic rather than a timestamp:** striking formwork is safety-critical.
Engineers already think in characteristic strength and partial safety factors — a
confidence level speaks their language, and it's the difference between decision *support*
and a tool pretending to make a safety call.

🔴 **Seed explicitly.** Demo output must be reproducible.

---

# THE SEVEN TRAPS

Every one produces output that looks completely reasonable:

| # | Trap | Formula |
|---|---|---|
| 1 | J/g vs J/kg — 1000× error | [9] → [27] |
| 2 | Timestep above stability limit | [30] |
| 3 | Ghost node instead of half-cell — 2× flux | [29] |
| 4 | Celsius inside the Arrhenius exponential | [23] |
| 5 | °F/mph in Uno while the rest is °C/m·s⁻¹ | [21] |
| 6 | Cloud cover ÷8 instead of ÷100 | [16], [19] |
| 7 | `T_ref` mismatched between maturity and strength | [23] vs [32] |

**Put the unit in every temperature variable's name or type.** Ambiguous temperature units
are the single most likely way this project ships confidently wrong numbers.
