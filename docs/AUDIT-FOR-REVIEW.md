# Audit for external review

Read-only audit of `backend/`. Nothing changed. Every extract pasted from disk, not
retyped. Paths repo-root relative; the Python package lives under `backend/`.

## Section 1 — Constants, verbatim

`physics/constants.py`, 48 lines, in full.

```python
"""Every literature constant, each with its source. No derived values, no logic."""

STEFAN_BOLTZMANN = 5.67e-8    # W/m2K4
GAS_CONSTANT = 8.314          # J/mol/K
EA_BASE = 33500.0             # J/mol, ASTM C1074
EA_COLD_SLOPE = 1470.0        # J/mol per degC below 20C, ASTM C1074
T_REF_DEFAULT_C = 20.0        # must match strength calibration
T_DATUM_DEFAULT_C = -10.0     # ASTM C1074 Nurse-Saul datum
LATENT_HEAT_VAP = 2.45e6      # J/kg
RHO_DEFAULT = 2400.0          # kg/m3
CP_DEFAULT = 1000.0           # J/kg/K
K_DEFAULT = 2.2               # W/m/K
EMISSIVITY = 0.90             # concrete
SOLAR_ABSORPTIVITY = 0.55     # fresh concrete, range 0.50-0.65
H_CEM_DEFAULT = 500.0         # J/g when the cement type is unknown. USBR DSO-12-02.
# was 470: field data shows it under-predicts. Stony Gorge measured rise 104 degF
# against 96 predicted. Modern cements grind finer, so more heat per unit binder.

# Cement heat by ASTM C150 type, J/g. One global H_cem is why 500 fixed Stony Gorge
# (Type II) and hurt Deer Creek (Type II/V): C3A carries the largest Bogue coefficient
# at 866 J/g, and Type V is low-C3A by definition, so a II/V blend simply generates less
# heat per unit cement. These are the type means; the ensemble samples around them.
H_CEM_BY_TYPE = {
    "I": 510.0,      # highest C3A
    "II": 500.0,     # confirmed against the Stony Gorge field rise
    "II/V": 470.0,   # low C3A
    "V": 450.0,      # lowest
}

# ASTM C1074 switches the activation energy slope at 20 C. this is a fixed
# breakpoint in the standard, NOT the reference temperature. do not tie it to T_ref.
EA_BREAKPOINT_C = 20.0

# Schindler & Folliard 2005, regression on 352 response variables
ALPHA_U_A = 1.031
ALPHA_U_B = 0.194
ALPHA_U_FA = 0.50    # fly ash term. POSITIVE.
ALPHA_U_SLAG = 0.30  # slag term. POSITIVE.
ALPHA_U_CAP = 1.09

# ---- retired PROVISIONAL: DEF_LIMIT_C, CRACK_LIMIT_C and H_CEM_DEFAULT are now
# fixed against USBR DSO-12-02 measurements. The rest below stay PROVISIONAL. ----
BETA_DEFAULT = 0.9      # PROVISIONAL. eqn [11] SO3 exponent sign unconfirmed
DEF_LIMIT_C = 68.3      # 155 degF, USBR/Reclamation design max. was 70.0.
# conditional on cement chemistry - see physics.limits.def_threshold_c
CRACK_LIMIT_C = 19.4    # 35 degF, ACI 207 / GDOT. was 20.0
PLACEMENT_MAX_C = 32.0  # PROVISIONAL. ACI 305, often project-specific
STRIP_FRACTION = 0.75   # PROVISIONAL. 70-75% of f'c, ACI 347
```

The evaporation threshold is **not** here — it lives in `physics/limits.py`:

```python
# ACI 305R: above this, plastic shrinkage cracking is likely without protection.
EVAP_LIMIT_KG_M2_H = 1.0    # = 0.2 lb/ft2/h, the classic Uno nomograph line
```

Also in `limits.py`, for §2(d):

```python
DEF_ETTRINGITE_C = 70.0    # 158 degF, USBR DSO-12-02
SO3_OVER_AL2O3_MAX = 0.7      # dimensionless ratio, unit-invariant
SO3_SQ_OVER_AL2O3_MAX = 0.020  # mass-fraction basis, = 2.0 on a percent basis
```

---

## Section 2 — Four specific questions

### (a) alpha_u cap

Code enforces **1.09**, as SPEC-04 R1 asserts (`equations/hydration.py:19-21`):

```python
def ultimate_degree(w_cm: float, p_fa: float = 0.0, p_slag: float = 0.0) -> float:
    a = ALPHA_U_A * w_cm / (ALPHA_U_B + w_cm) + ALPHA_U_FA * p_fa + ALPHA_U_SLAG * p_slag
    return min(a, ALPHA_U_CAP)
```

**No source comment on `ALPHA_U_CAP` itself.** It sits under one shared header,
`# Schindler & Folliard 2005, regression on 352 response variables`, covering five names.
The only justification is `docs/SPEC-04-AMENDMENTS.md:21`:

> - Cap is **1.09**, not 1.00 — the regression allows it because degree of hydration here is
>   referenced to cement, not to total binder.

So: **asserted in a spec, then implemented.** No primary citation in code; `MixSpec`
repeats it as a bound, `alpha_u: float | None = Field(default=None, gt=0.0, le=1.09)`.

Unresolved: the spec justifies the cap on a *cement* basis, but `ultimate_heat_j_per_kg`
returns H_u on a **total cementitious** basis (`Mix.cement_kg_m3` is total cementitious in
`standard_mix()` and `validation/runner.py`), so `alpha_u * H_u * C_c` mixes bases. I cannot
tell from code which is intended.

### (b) Silica fume

**`MixSpec` has no silica fume field.** Its whole mix surface: `mix_id`, `cement_type`,
`cement_kg_m3`, `w_cm`, `fly_ash_frac`, `h_u_j_per_kg`, `alpha_u`, `tau_h`, `beta`, `grade`.
No slag field either — `ALPHA_U_SLAG` and the `461.0 * p_slag` term are unreachable from the
API. Silica fume appears nowhere in `physics/`; only in two YAML case files and a limitation
note in `validation/report.py`. Deer Creek's case file:

```yaml
  silica_fume_kg_m3: 27.3      # 46 lb/yd3 - NOT in the Schindler H_u formula, see notes
  cementitious_kg_m3: 571.9    # 964 lb/yd3
```

`validation/runner.py:189-192` builds fractions, never using it:

```python
    cementitious = float(mix["cementitious_kg_m3"])
    p_fa = float(mix["fly_ash_kg_m3"]) / cementitious
    p_cem = float(mix["cement_kg_m3"]) / cementitious
```

p_cem = 0.7625, p_fa = 0.1899, sum 0.9524. **Plainly: 4.77% of Deer Creek's binder
(27.3 of 571.9 kg/m³) is modelled as inert** — absent from H_u, tau, beta and alpha_u. It
does enter `cement_kg_m3 = cementitious`, so it carries mass but no heat. Divergent
convention: the API design branch (`simulate.py:119`) uses `p_cem=1.0 - p_fa`, counting any
non-fly-ash binder as **cement**; the validation runner uses the true cement fraction.

### (c) Strip time

`physics/season_analysis.py:215-223`, the path `/api/simulate` uses:

```python
def deterministic_strip_time_h(
    result: SolveResult, grade: str = STANDARD_GRADE, target_fraction: float = STRIP_FRACTION
) -> float:
    weakest_t_e_h = np.nanmin(result.t_e_h_frames, axis=(1, 2))
    fraction = strength_fraction(weakest_t_e_h, params_for(grade))
    reached = np.nonzero(fraction >= target_fraction)[0]
    if reached.size == 0:
        return float("nan")
    return float(result.times_h[reached[0]])
```

The criterion is a **fraction, not an absolute MPa**: 0.75 of modelled 28-day strength,
where 28 days is `AGE_28_H = 672.0` hours of *equivalent age* (`strength_model.py:64-66`):

```python
def strength_fraction(t_e_h: Floats, params: StrengthParams) -> FloatArray:
    s_28_mpa = float(strength_mpa(AGE_28_H, params))
    return np.asarray(strength_mpa(t_e_h, params) / s_28_mpa, dtype=np.float64)
```

`params_for(grade)` returns PROVISIONAL parameters — docstring: "a placeholder shape, not
this mix's strength." `4000psi` is `s_u_mpa=31.7, tau_s_h=20.0, beta_s=0.85`, unmeasured.
The ensemble path (`uncertainty.py:405`) is the same fraction at p95.

### (d) DEF gate

The gate exists, `physics/limits.py:37-51`:

```python
def def_threshold_c(so3_frac: float, al2o3_frac: float) -> float:
    if al2o3_frac <= 0.0:
        raise ValueError("al2o3_frac must be positive")
    if not 0.0 <= so3_frac <= 1.0 or not 0.0 <= al2o3_frac <= 1.0:
        raise ValueError("so3_frac and al2o3_frac are mass fractions 0-1, not percentages")

    resistant = (
        so3_frac / al2o3_frac < SO3_OVER_AL2O3_MAX
        and so3_frac**2 / al2o3_frac < SO3_SQ_OVER_AL2O3_MAX
    )
    return DEF_ETTRINGITE_C if resistant else DEF_LIMIT_C
```

**Unreachable in production.** Its only repo-wide callers are `tests/test_limits.py`;
`app/services/simulate.py:174-181` hardcodes the unconditional limit:

```python
    threshold_c = DEF_LIMIT_C
```

commented `limits.def_threshold_c can relax it ... but MixSpec carries no alumina content`.
Confirmed: **DEF is flagged on temperature alone**, against a fixed 68.3 °C, on both the
probe peak and the hottest cell. The relaxed 70.0 °C branch never fires outside tests.

---

## Section 3 — Hydration and boundary equations, verbatim

**`cement_heat_j_per_g`** — Bogue fractions in, J/g out.

```python
    return (
        500.0 * p_c3s
        + 260.0 * p_c2s
        + 866.0 * p_c3a
        + 420.0 * p_c4af
        + 624.0 * p_so3
        + 1186.0 * p_free_cao
        + 850.0 * p_mgo
    )
```

**`ultimate_heat_j_per_kg`** — J/g cement, mass fractions in; **J/kg binder** out.

```python
    h_j_per_g = h_cem_j_per_g * p_cem + 461.0 * p_slag + 1800.0 * p_fa_cao * p_fa
    return h_j_per_g * 1000.0
```

**`tau_hours`** — mass fractions, Blaine m²/kg in; hours out.

```python
    return float(
        66.78
        * p_c3a**-0.154
        * p_c3s**-0.401
        * blaine_m2_kg**-0.804
        * p_so3**-0.758
        * np.exp(2.187 * p_slag + 9.50 * p_fa * p_fa_cao)
    )
```

**beta**: no beta function exists. `BETA_DEFAULT = 0.9` is used everywhere; the
SPEC-04/05 regression (`β = 181.4 · p_C3A^0.146 · …`) is **not implemented**. The
ensemble perturbs beta ±10% about 0.9.

**`degree_of_hydration`** — equivalent-age hours in, dimensionless out.

```python
    t_e = np.maximum(np.asarray(t_e_h, dtype=np.float64), 1e-6)  # trap: overflow at t=0
    return np.asarray(alpha_u * np.exp(-((tau_h / t_e) ** beta)), dtype=np.float64)
```

**`heat_rate_w_m3`** — equivalent-age h, °C in; W/m³ out.

```python
    dadte_per_h = d_alpha_d_te(t_e_h, alpha_u, tau_h, beta)
    dadt_per_h = dadte_per_h * rate_multiplier(temps_c, t_ref_c)
    dadt_per_s = dadt_per_h / 3600.0  # TRAP: must be 1/s here
    return np.asarray(h_u_j_per_kg * c_c_kg_m3 * dadt_per_s, dtype=np.float64)
```

**Arrhenius rate multiplier** — °C in, dimensionless out; kelvin only inside.

```python
def rate_multiplier(temps_c: Floats, t_ref_c: float = T_REF_DEFAULT_C) -> FloatArray:
    t_c = np.asarray(temps_c, dtype=np.float64)
    t_k = t_c + 273.15
    exponent = activation_energy_j_mol(t_c)
    exponent /= -GAS_CONSTANT
    exponent *= 1.0 / t_k - 1.0 / (t_ref_c + 273.15)
    return np.asarray(np.exp(exponent, out=exponent), dtype=np.float64)
```

`activation_energy_j_mol` = `EA_BASE + max(EA_COLD_SLOPE * (20 - T_c), 0)`, J/mol; `EA_BASE`
resolves from the module namespace at call time and the ensemble rebinds it (§7).

**Evaporation (Uno)** — °C, fraction, m/s in; **kg/m²/s** out:

```python
# ACI 305.1-14 Uno. celsius + m/s in, kg/m2/s out. imperial NEVER escapes. trap 5.
def evaporation_rate_kg_m2_s(
    surface_temp_c: Floats, air_temp_c: Floats, rh_frac: Floats, wind_ms: Floats
) -> FloatArray:
    tc_f = np.asarray(surface_temp_c, dtype=np.float64) * 9.0 / 5.0 + 32.0
    ta_f = np.asarray(air_temp_c, dtype=np.float64) * 9.0 / 5.0 + 32.0
    v_mph = np.asarray(wind_ms, dtype=np.float64) * 2.23694
    rh = np.asarray(rh_frac, dtype=np.float64)
    e_lb_ft2_h = (
        (np.maximum(tc_f, 0.0) ** 2.5 - rh * np.maximum(ta_f, 0.0) ** 2.5)
        * (1.0 + 0.4 * v_mph)
        * 1e-6
    )
    return np.asarray(np.maximum(e_lb_ft2_h, 0.0) * 1.3562e-3, dtype=np.float64)
```

`1.3562e-3` checks out: lb/ft²/h → kg/m²/s = 0.45359237/0.09290304/3600 = 1.35623e-3.

**`face_temp_c`** — centre °C, air °C, W/m²K, W/m², m, W/mK in; face °C out.

```python
    half_cell = 2.0 * k_w_m_k / dx_m
    film = np.asarray(h_film_w_m2_k, dtype=np.float64)
    numerator = film * np.asarray(air_temp_c) + np.asarray(q_ext_w_m2) + half_cell * centre_temp_c
    return np.asarray(numerator / (film + half_cell), dtype=np.float64)
```

**`face_q_discrete`** — W/m², W/m²K in; W/m² out (share reaching the cell centre).

```python
    h = np.asarray(h_face_w_m2_k, dtype=np.float64)
    q = np.asarray(q_face_w_m2, dtype=np.float64)
    return np.asarray(q / (1.0 + h * dx_m / (2.0 * k_w_m_k)), dtype=np.float64)
```

Sibling `face_h_discrete` is `h / (1.0 + h * dx_m / (2.0 * k_w_m_k))`, same factor.

*Cut:* `h_convective`, `h_radiative`, `h_effective`, `sky_temperature_c`,
`cloud_attenuation`, `absorbed_solar_w_m2`, `neighbour_counts`, `max_stable_dt_s`,
`conduction.step`, `equivalent_age_h`, `nurse_saul_ch`, `d_alpha_d_te` — all under 20 lines
in `physics/equations/`. `ultimate_degree` and `deterministic_strip_time_h` are in §2.

---

## Section 4 — `/api/simulate` response

`app/models/__init__.py`, class `SimulationResult`. **✓ read by frontend, ✗ ignored.**

`list[float]`: `times_h` ✓, `core_temp_c` ✓, `surface_temp_c` ✓, `equivalent_age_h` **✗**
(typed in `api.ts`, never read), `strength_fraction` ✓, `probe_xy_m` ✓. `float`:
`peak_core_temp_c` ✓, `peak_core_time_h` ✓, `max_core_surface_diff_c` ✓,
`max_anywhere_surface_diff_c` ✓, `max_core_temp_anywhere_c` ✓, `t_ref_c` ✓,
`peak_evaporation_kg_m2_h` ✓. Then `strip_time_h: float | None` ✓,
`outline_m: list[list[float]]` ✓, `breaches: BreachFlags` ✓,
`ensemble: EnsembleResult | None` ✓, `fields: FieldFrames | None` ✓.

`BreachFlags` (all read): `def_risk: bool`, `def_threshold_c: float`,
`def_tripped_by: TrippedBy`, `cracking: bool`, `cracking_limit_c: float`,
`cracking_tripped_by: TrippedBy`, `evaporation: bool`,
`evaporation_limit_kg_m2_h: float`, `placement: bool`, `placement_limit_c: float`.

`EnsembleResult`: `n_samples: int`, `seed: int`, `dx_m: float`, `core_temp_c: Bands`,
`surface_temp_c: Bands`, `strength_fraction: Bands`, `equivalent_age_h: Bands`,
`strength_probability: list[float]`, `strip_time_h_p95: float | None`,
`forecast_error: dict[str, Any]`; `Bands` = `p05/p25/p50/p75/p95`, each `list[float]`.
**Only `core_temp_c` bands are drawn** (`EnsemblePanel.tsx:31`); the other three bands and
`strength_probability` are computed, serialised, ignored.

**Per-cell temperature field: yes**, opt-in via `?fields=true`. `FieldFrames`: `nx: int`,
`ny: int`, `dx_m: float`, `times_h: list[float]`, `frame_indices: list[int]`,
`temp_c: list[list[list[float | None]]]`. Shape `[n_kept_frames][ny][nx]`, `null` outside
the mask, row 0 = base, y up, cell (j,i) centred at `((i+0.5)·dx, (j+0.5)·dx)`. The frame
axis is thinned by `fields_stride_h` (default 1.0 h), always keeping frame 0, the peak-core
frame and the last; x and y are never resampled.

---

## Section 5 — What the tests assert

1. **Adiabatic rise** — `ΔT = H_u·C_c·α_u/(ρ·c_p)` = 52.5 °C three ways (`Mix` property,
   solver-free source integration over 28 days, sealed full-solver run, all `rel=0.02`),
   plus field uniformity and surface==core. **Closed form**, solver-independent.
2. **Pure decay** — no source ⇒ every cell cools monotonically, never exceeds initial,
   never undershoots ambient, surface leads core. **Physical property**, but qualitative —
   the erf solution was deliberately not used.
3. **Maturity identities** — Nurse–Saul exactly `(T−T_datum)·t`; Arrhenius equivalent age
   exactly elapsed time at `T = T_ref`, four T_ref values. **Identity**, exact to 1e-12.
4. **Energy balance** — generated == stored + lost **every** timestep, residual < 1e-9.
   **First law**, but a bookkeeping identity of this scheme: internal consistency only.
5. **Grid convergence** — peak core at dx 10 vs 5 mm differ < 0.1 °C, peak time within
   0.5 h. **Convergence property** — mesh-independent, not right.

None compares against a published measurement — that lives in `validation/`. 1 and 3 are
external checks in the strongest sense (closed form / identity); 2, 4, 5 are property checks.
**None is a regression lock** on a number this code produced; I found no golden snapshots.

**132 test functions** across 17 files (plus 9 `parametrize` decorators). Untested:

- **`physics/strength_model.py` has no test file** — `GRADE_PARAMS`, `strength_mpa`,
  `strength_fraction`, `params_for` run only indirectly via `test_uncertainty`/`test_season`;
  `tests/test_strength_stub.py` tests that the *stub* in `equations/strength.py` raises.
- `to_mix`'s design-derivation branch (`simulate.py:108-132`); `to_field_frames`
  stride/keep-set logic; sign or magnitude of `solve`'s sky-radiation-deficit q term
  (`solver.py:191-193`). `def_threshold_c` is tested but never wired, so its integration is
  untested by construction.

---

## Section 6 — Current published numbers (from artifacts on disk)

**Validation** — `docs/VALIDATION.json`, `2026-08-23T21:30:35+00:00`, N = 300, pass bar
90% coverage, band-width warning 25.0 °C.

- `deer_creek_adiabatic` — 100.0% (1/1), **PASS**, band 23.5 °C
- `deer_creek_p4_2008` — 40.0% (2/5), **FAIL**, band 25.6 °C, flagged *too wide*
- `stony_gorge_2008` — 40.0% (2/5), **FAIL**, band 21.8 °C

Peak core error: adiabatic +3.6 °C (+5.9%), Deer Creek P4 +0.1 °C, Stony Gorge −7.9 °C.
Worst checkpoint −26.5 °C (Deer Creek 12 h) and −28.1 °C (Stony Gorge 12 h); both field
cases sit inside the band only at 48 h and 72 h.

**Season** — `backend/data/cache/season-analysis.json`: 30 days, stride 3, 2025-06-03 to
2025-08-29 (88-day span, 34.1% coverage), Phoenix, standard 300 mm slab. n = 30 per hour.
Flags, 04:00 / 14:00 — DEF 0/30 / 0/30; cracking 30/30 / 30/30; evaporation 30/30 / 30/30;
placement **18/30 (60%) / 30/30 (100%)**. Mean peak core 53.2 / 59.1 °C; mean hottest cell
55.7 / 63.6 °C; mean strip 44.7 / 45.3 h; 0 days never stripped.

**Demo ensemble** — `backend/data/cache/demo-ensemble.json`, `2026-08-23T22:05:43+00:00`,
**N = 2048**, scrambled Sobol, seed 0, dx = 20 mm, dt = 30 s, ten sampled parameters.
Peak of the bands: **p05 55.48 °C, p50 64.66 °C, p95 76.42 °C**; `strip_time_h_p95` 44.83 h.
Per the artifact's own note, read the upper edge to ~0.3 °C and the lower to ~0.15 °C, not
the printed precision.

**Convergence order** — `backend/results/grid-order-20260823T211135Z-be95ada.json`,
300 mm slab, 2025-07-15, hour 14, dx ∈ {5, 10, 15, 20} mm. Baseline arm: **p = 2.05,
measured on `max_core_temp_anywhere_c` (hottest cell)**, Richardson 65.80 °C. On the
**probe** `peak_core_temp_c` order is `null` — "differences below the floor or opposite
in sign - order undefined".

---

## Section 7 — What I would flag, ranked by effect on a published number

**1. Two of three validation cases FAIL, and one failing band is self-declared too wide to
be evidence.** The only PASS is a lab adiabatic test with a 23.5 °C band.

**2. Strip time is a fraction of an admittedly invented strength curve.** `GRADE_PARAMS`
is `PROVISIONAL. … NOT measured on any mix here`, and the module notes 20% fly ash pushes
`tau_s` up unmodelled, so "early-age fractions below are optimistic." Every published strip
number (44.7, 45.3, 44.83 h p95) inherits that, and optimistic is the unsafe direction.
Industry uses absolute MPa; ours is a fraction of a guess.

**3. Silica fume is inert (4.8% of Deer Creek's binder); slag is unreachable.** `MixSpec`
expresses neither. Bias is documented LOW, and Deer Creek already over-predicts, so the true
over-prediction is worse than reported — nobody has quantified how much.

**4. The DEF chemistry gate cannot fire.** Dead outside tests; DEF is temperature-only, and
its relaxed 70 °C branch is an explicit INTERPRETATION of DSO-12-02.

**5. `ALPHA_U_CAP = 1.09` has no source comment and no primary citation.** Spec-asserted,
implemented, re-stated as a `MixSpec` bound. Secondary sources giving 1.0 is a conflict I
cannot adjudicate here, and the spec's cement-basis justification looks inconsistent with
H_u's total-binder basis (unresolved). It bites only at high w/cm with heavy fly ash;
standard and validation mixes sit below it.

**6. Convergence order is undefined on the number we publish.** p = 2.05 is on the hottest
cell; on `peak_core_temp_c` it is `null`. Two arms are worse than baseline: `E_q_half`
p = 1.12, `F_q_full` p = 0.50. **Comment vs artifact disagree:** `conduction.py:60-61` still
quotes pre-fix figures ("baseline p = 0.82 … halving q raised p from 1.31 to 1.56").

**7. `BETA_DEFAULT = 0.9` is PROVISIONAL** — `eqn [11] SO3 exponent sign unconfirmed` — and
the beta regression both specs publish is not implemented. beta is the exponent in
`exp(-(tau/t_e)^beta)`, so it shapes the whole heat curve; the ensemble perturbs it ±10%
about an unconfirmed number.

**8. `EVAP_LIMIT_KG_M2_H = 1.0    # = 0.2 lb/ft2/h`** is not an equality: 0.2 lb/ft²/h =
0.9765 kg/m²/h, so the limit is 2.4% loose. Both hours already breach 100% of days, so no
number moves today; the comment is still wrong.

**9. Constants with no source comment:** `RHO_DEFAULT`, `CP_DEFAULT`, `K_DEFAULT`,
`EMISSIVITY`, `LATENT_HEAT_VAP`, `SOLAR_ABSORPTIVITY`; every `FORMWORK_R` value; the
`h_convective` coefficients; the 6.0 °C clear-sky offset; the seven Bogue coefficients; the
`461.0` slag and `1800.0` fly-ash-CaO terms; every coefficient in `tau_hours`. Module
docstrings name sources; the numbers are not individually attributed. `H_CEM_DEFAULT = 500.0`
cites USBR DSO-12-02, but its comment shows it was **raised from 470 to fit Stony Gorge** —
which is then a validation case. Calibration presented as literature.

**10. Provisional / stubbed / unreachable:** `provisional_error()` — the ensemble's ambient
spread is an invented 0.5→2.0 °C ramp with `n_pairs = 0`, feeding the published p05/p95.
`equations/strength.py` raises `NotImplementedError`. `on_ground=True` is refused at the API
boundary, yet `validation/runner.py` builds `Element` directly and uses it for Deer Creek P4:
a zero-flux base biasing the core HIGH on the case that already over-predicts.

**11. Silent-unit risks:** `cloud_pct` is percent while upstream calls it octas (guarded);
J/kg vs J/g (golden 1); Uno's imperial round trip (ACI worked example);
`SO3_SQ_OVER_AL2O3_MAX = 0.020` mass-fraction vs 2.0 percent (guarded, but unreachable).
`Mix.cement_kg_m3` is named "cement" and holds **total cementitious** everywhere.

**12. Told but not personally verified:** that `H_CEM_BY_TYPE` values are literature means
(only Type II carries a stated confirmation); that the YAML case files faithfully transcribe
DSO-12-02 (I read the YAML, not the source); that the demo-ensemble note's seed-to-seed sd
figures were measured as claimed. I ran no tests.

---

*Cut for budget:* remaining `equations/` bodies (§3); per-case checkpoint arrays and the
eight validation limitation notes (§6); the 127 non-golden tests individually (§5). §1 runs
over its 400-word budget because the mandated full paste of `constants.py` is ~340 words.
