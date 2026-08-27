# Limitations

Everything below is known, measured where a number exists, and unfixed in this build.
It is here because a thermal model that does not say where it is weak is not evidence,
it is a picture. Each item states what is wrong and which number it moves.

Nothing in this document is a bug report against code that is about to change. These are
the standing limits of what SatAlite currently claims.

---

## 1. One constant was fitted against a validation case

`H_CEM_DEFAULT` is 500 J/g. It was 470. The comment on it in `physics/constants.py` says
why it moved:

> was 470: field data shows it under-predicts. Stony Gorge measured rise 104 degF
> against 96 predicted.

Stony Gorge is validation case 2. `H_CEM_BY_TYPE["II"] = 500.0` carries the same note,
"confirmed against the Stony Gorge field rise", and Stony Gorge is the Type II case.

So one chemistry constant was adjusted against a case that is also a validation case.
Stony Gorge's agreement is therefore not independent evidence about that constant. Our own
decision log records that chemistry was deliberately not tuned to fit the field data; this
is the one place where that rule was broken, and it is the reason the rule is worth
stating.

The rest of the hydration chain is untouched by this: the Schindler-Folliard regressions
for H_u, alpha_u and tau were transcribed from the paper and no coefficient in them has
been moved.

## 2. Deer Creek P4 validates with a base the API refuses to solve

`validation/runner.py` builds `Element` directly and sets `on_ground=True` from the case
file. The API cannot express that: `ElementSpec` rejects `on_ground=True` outright, because
`geometry.rasterize` tags the base GROUND and the solver counts only EXPOSED and FORMED
faces, so a GROUND face carries zero flux. That is a perfectly insulated base, which
over-predicts the core.

The validation harness and the shipped product therefore solve two different problems on
this case. That is the limitation, and it is real.

What it is worth was measured by running the case both ways, 300 samples each:

| | peak p05 / p50 / p95 | peak error vs measured 74.0 °C | band width | coverage |
|---|---|---|---|---|
| `on_ground=True` (as validated) | 62.042 / 74.104 / 87.613 °C | +0.104 °C | 25.571 °C | 40% (2/5) |
| `on_ground=False` (base exposed) | 61.972 / 74.019 / 87.529 °C | +0.019 °C | 25.557 °C | 40% (2/5) |

The insulated base is worth **+0.085 °C** on the median peak. It was estimated
beforehand at +2.5 °C; the measurement does not support that. On a 1981 mm × 3048 mm
buttress the core sits about a metre from every face, and over 200 hours the base
condition barely reaches it. The largest movement is at the 168 h checkpoint, where the
error falls from +18.20 °C to +16.92 °C.

So the case's peak agreement is **not** materially assisted by the insulated base. It
remains true that the configuration validated is one the API will not run, and that a
+0.1 °C headline peak error sits beside checkpoint errors of −26.5 °C at 12 h and
+18.2 °C at 168 h. The peak agreement is a coincidence of a wide band and a badly
reconstructed early-age curve, not a demonstration of accuracy.

## 3. Silica fume is modelled as inert

Deer Creek's mix carries 27.3 kg/m³ of silica fume in 571.9 kg/m³ of cementitious
material — 4.77% of the binder.

Schindler & Folliard 2005 regresses Class F fly ash, Class C fly ash and GGBF slag. It has
no silica fume term at all: not in H_u, not in tau, not in beta, not in alpha_u. Silica
fume is therefore carried as mass and generates no heat. That mix is outside the
regression's calibration domain, and the direction of the error is cold and late, which
matches the observed residual on that case.

Slag is not expressible from the API at all. `ALPHA_U_SLAG` and the `461.0 * p_slag` heat
term exist in `physics/equations/hydration.py` and are unreachable from `MixSpec` on
purpose: accepting slag without wiring those terms would model it as inert, and unlike
silica fume slag is not inert. That would under-predict temperature, which is the
direction that misses a DEF flag.

## 4. The forecast error band is invented

`provisional_error()` in `physics/forecast_error.py` returns a sigma ramping linearly from
0.5 °C at 1 h lead to 2.0 °C at 12 h, with `n_pairs = [0] * 12`. Zero measured pairs. The
function says so itself: "a plausible shape for a short-range near-surface forecast, NOT a
measurement of this API".

That invented sigma is what widens the ambient in every ensemble member, so it feeds
directly into every published p05/p95.

It matters more than its size suggests. In the one-at-a-time sensitivity sweep
(`results/mc-oat-20260823T211156Z-be95ada.json`) `forecast_z` ranks **9th of 10** on peak
core temperature, worth 1.01 °C — but **2nd of 10** on strip time, worth −5.67 h, behind
only the activation energy. The strip-time band is therefore substantially made of a
parameter nobody has measured.

The machinery to replace it exists and is tested: `empirical_forecast_error()` pairs cached
forecasts against later observations for the same tile. It has no data yet.

## 5. Strip time is a fraction of an unmeasured strength curve

`GRADE_PARAMS` in `physics/strength_model.py` is labelled PROVISIONAL in its own comment:
nominal grades converted from psi, ultimate taken as 1.15× nominal, tau_s and beta_s "set
mid-range for ordinary Type I/II mixes. NOT measured on any mix here". The comment also
notes that a 20% fly ash replacement pushes tau_s up and that this is not modelled, "so
early-age fractions below are optimistic for the standard mix".

There is no `test_strength_model.py`. No test file imports the module; it is exercised only
through whatever calls it.

On top of that, the striking criterion itself is non-standard. `STRIP_FRACTION = 0.75`
means 75% of a *modelled* 28-day strength. Industry practice specifies striking in absolute
terms, roughly 10–20 MPa depending on the element and the code.

Optimistic is the unsafe direction here: a strip time that is too early takes formwork off
concrete that has not reached strength.

## 6. The DEF chemistry gate cannot fire

`physics/limits.py` provides `def_threshold_c(so3_frac, al2o3_frac)`, which relaxes the DEF
temperature limit for a cement whose sulphate-to-alumina chemistry resists delayed
ettringite formation. It is called only by tests.

`app/services/simulate.py` hardcodes `threshold_c = DEF_LIMIT_C` and says why: `MixSpec`
carries no alumina content, so relaxing the limit would mean relaxing a safety limit on a
number nobody supplied. That is the right call, but the consequence is that in this build
DEF is flagged on temperature alone, at 68.3 °C (155 °F), for every mix regardless of
chemistry.

The relaxed branch also rests on an interpretation. DSO-12-02 states that both Deer Creek
placements exceeded 155 °F and that DEF was ruled out on that chemistry, but it never names
the relaxed number; taking it as the 158 °F ettringite threshold is our reading of the same
document, flagged as such in the code.

## 7. This is not an ASTM C1074 maturity instrument

ASTM C1074 requires that the temperature history be **recorded**. SatAlite predicts it.

A predicted maturity is not a measured maturity, and no amount of agreement makes it one.
A SatAlite output is therefore not an ASTM C1074 maturity estimate, and the Pour Record is
not a compliance document.

What we do claim:

- **Planning.** Deciding when to pour, before there is anything to instrument.
- **What-if.** Changing the mix, the section, the formwork or the start hour and seeing
  where the peak and the differential go.
- **Reconstruction.** Rebuilding the conditions a placement experienced from the ambient
  record, after the fact.

None of that substitutes for an embedded sensor in a compliance chain. If a specification
calls for maturity-based acceptance, it calls for a thermocouple.

## 8. Validation stands at 1 of 3

From `docs/VALIDATION.json`, 300 samples per case, coverage of the p05–p95 band as the
primary metric with a 90% bar:

| case | kind | coverage | peak band width | median peak error |
|---|---|---|---|---|
| `deer_creek_adiabatic` | adiabatic | **100%** (1/1) | 23.47 °C | +5.93% on rise |
| `deer_creek_p4_2008` | field | **40%** (2/5) | 25.57 °C | +0.10 °C |
| `stony_gorge_2008` | field | **40%** (2/5) | 21.76 °C | −7.89 °C |

The adiabatic case passes on a single checkpoint inside a 23.5 °C band. Both field cases
fail. Deer Creek's 25.6 °C peak band exceeds our own `BAND_WIDTH_WARN_C` of 25.0 °C, and
the report flags it: a band that wide contains almost anything and is not evidence even
when it covers.

Both field cases miss in the same way and in the same direction — badly cold at 12 h and
24 h (−26.5 and −25.1 °C at Deer Creek; −28.1 and −23.6 °C at Stony Gorge), then crossing
to warm by 168 h. That is a shape error in the early-age curve, not a scatter, and the most
likely cause is the ambient reconstruction: no hourly weather exists for either case, so
the daily minimum is inferred as `2*mean - max`, forcing a symmetric diurnal swing that
real weather does not have. That reconstruction is not varied by the ensemble, so its error
sits outside the band rather than inside it.

## 9. Time to peak runs late, and it is a bias rather than scatter

Seven instrumented ALDOT mass concrete elements from Gross, Eiland, Schindler & Barnes
(December 2017), *Temperature Control Requirements for the Construction of Mass Concrete
Members*, Auburn University Highway Research Center, ALDOT report **930-860R**, were run
through `POST /api/simulate` at dx = 20 mm over 168 h, with hourly ambient taken from the
Open-Meteo historical archive at each site's coordinates. Nothing in this codebase has been
fitted to any of them.

The report names towns rather than coordinates, so the runs used town centres, listed here
because without them nothing below can be re-run: Albertville 34.2676 / −86.2088,
Harpersville 33.3448 / −86.4394, Scottsboro 34.6723 / −86.0344 (both elements), Elba
31.4165 / −86.0688, Birmingham 33.5186 / −86.8104, Brewton 31.1052 / −87.0722, all on
America/Chicago. Re-run against this commit on 2026-08-27 these reproduce every peak core
temperature to within 0.01 °C and every differential to within 0.06 °C, except Birmingham,
which lands 0.13 to 0.26 °C low at every probe depth and +0.1 h late — a uniform offset with
the peak temperature unmoved, which is a slightly wrong site coordinate rather than a
different model.

Error on time to peak core temperature, predicted minus measured:

| Element | measured | predicted | error |
|---|---|---|---|
| Albertville bent cap | 20 h | 34.7 h | +14.7 h |
| Harpersville crashwall | 27 h | 29.3 h | +2.3 h |
| Scottsboro pedestal | 45 h | 53.2 h | +8.2 h |
| Scottsboro bent cap | 27 h | 33.0 h | +6.0 h |
| Elba bent cap | 18 h | 30.0 h | +12.0 h |
| Birmingham column | 30 h | 33.2 h | +3.2 h |
| Brewton bent cap | 27 h | 41.2 h | +14.2 h |

**Mean +8.7 h, and all seven errors are positive.** `docs/VALIDATION-CASES.md` sets the
acceptance criterion for time to peak at ±8 h; four of the seven miss it.

The peak *temperature* on the same seven runs is not biased in the same way — errors are
−3.8, −7.8, +1.9, +9.5, +4.7, +6.0 and −4.1 °C, four positive and three negative, mean
+0.9 °C with a mean absolute error of 5.40 °C. So the model gets roughly the right peak at
roughly the wrong time. That is a shape error in the early-age curve, which is the same
diagnosis as item 8 above, reached from a second and independent dataset — and reached here
with *measured* hourly weather, so the `2*mean - max` reconstruction blamed in item 8 cannot
be the whole of it.

Which numbers it moves: `peak_core_time_h` directly, and `strip_time_h` through it, because
a curve that rises late accumulates equivalent age late. It does not move
`peak_core_temp_c` by a consistent amount in a consistent direction.

Three caveats on the runs themselves.

The Auburn mixes are Type **I/II** cement. When these runs were made `H_CEM_BY_TYPE` carried
only `I`, `II`, `II/V` and `V`, so `"I"` (510 J/g) was substituted; `"II"` moves the
Albertville peak by −0.9 °C. `H_CEM_BY_TYPE` has since gained **`"I/II" = 505.0`**, so the
designation now solves directly — but the numbers above were produced with 510 and have not
been re-run at 505. The difference is 1% on `H_cem`, about 0.1 °C on peak core.

The ambient is Open-Meteo rather than FortyGuard, because the FortyGuard archive begins
2021-01-01 and these placements are 2015–2016. This validates the physics, not the
hyperlocal data path.

**And the cement chemistry was assumed when the report measures it.** Appendix Tables B-2
through H-2 of 930-860R publish the full Bogue set — C3S, C2S, C3A, C4AF, SO3, MgO — and the
Blaine fineness, per element, from the mill certificate. `MixSpec` carries no field for any
of it, so a design mix goes down the `w_cm` / `fly_ash_frac` branch of
`app/services/simulate.py::to_mix` and `tau_hours` is called with the generic constants in
`physics/season_analysis.py`: `P_C3A = 0.08`, `P_C3S = 0.55`, `P_SO3 = 0.03`,
`BLAINE_M2_KG = 380.0`. Albertville's certificate reads 0.054, 0.609, 0.0279 and 448.9.

Measured on this commit, that substitution is worth:

| | assumed | Albertville measured |
|---|---|---|
| `tau_hours` | 17.339 h | **16.341 h** (Blaine alone: 15.165 h) |
| `cement_heat_j_per_g` on the measured Bogue compounds | — | **462.2 J/g**, against the 510 used |

The two effects pull against each other. A shorter tau peaks earlier, which is the direction
of the bias this item is about — roughly 1 h of Albertville's 14.7 h, for free. But 462.2
against 510 is 9.4% less heat, which runs the peak colder, and Albertville is already 3.8 °C
cold. So the late-peak bias would narrow and the 5.40 °C peak error would probably widen.
Neither has been run. `cement_heat_j_per_g` already exists in
`physics/equations/hydration.py` and is reachable from nothing on the API path; wiring four
optional numbers through `MixSpec` is the experiment, and it is not in this build.

The same appendices also publish seven days of local weather per site, which is a second,
independent check on the Open-Meteo series used here. That has not been run either.

## 10. The core-to-surface differential reads far too high, and the flag saturates

Measured against the same seven ALDOT elements as item 9 — same report, same runs, same
caveats including the assumed cement chemistry — the predicted maximum core-to-surface
differential exceeds the measured one on every single case:

The predicted column is **`max_core_surface_diff_c`**: the hottest core cell against the
mean free surface. The response carries three other differentials and they are not
interchangeable — `max_anywhere_surface_diff_c` runs about 0.4 °C higher on these same runs
because it takes the hottest cell anywhere rather than the core.

| Element | measured max dT | predicted `max_core_surface_diff_c` | error |
|---|---|---|---|
| Albertville bent cap | 22.2 °C | 48.2 °C | +26.0 |
| Harpersville crashwall | 23.3 °C | 47.7 °C | +24.4 |
| Scottsboro pedestal | 37.8 °C | 61.7 °C | +23.9 |
| Scottsboro bent cap | 27.8 °C | 58.9 °C | +31.1 |
| Elba bent cap | 11.7 °C | 46.3 °C | +34.6 |
| Birmingham column | 10.6 °C | 46.3 °C | +35.7 |
| Brewton bent cap | 21.1 °C | 36.4 °C | +15.3 |

`CRACK_LIMIT_C` is 19.4 °C, so this predicts a breach on every one of them - including
Birmingham and Elba, which measured barely half the limit. A flag that fires on
everything carries no information, and `season-analysis.json` shows the consequence in
its headline: `pct_days_breaching_cracking` is **100.0% at both 04:00 and 14:00**.

### Part of it was the measuring point, and that part is fixed

`surface_temp_c` is the mean **true free surface**, reconstructed from the cell centre.
ACI 301's 35 degF is written against a thermocouple cast a few inches under a face, and
the free surface at 4 a.m. is much colder than that reading. The two are different
physical quantities and the flag was comparing one against the other's limit.

The solver now also reports `surface_probe_temp_c` at `Element.surface_probe_depth_m`
(default 0.050 m), with `max_core_probe_diff_c` and `max_anywhere_probe_diff_c`, and
**the cracking flag is evaluated on those**. The free-surface pair is still reported: it
is the strict upper bound on the gradient, and dropping it would hide how much of the
disagreement is probe placement.

### Most of it was not, and that part is unfixed

Sweeping the depth on four of the elements above. The free-surface column is
`max_core_surface_diff_c` and every depth column is `max_core_probe_diff_c` at that
`surface_probe_depth_m`:

| Element | measured | free surface | 25 mm | 50 mm | 100 mm | 150 mm |
|---|---|---|---|---|---|---|
| Birmingham column | 10.6 | 46.3 | 42.9 | 40.7 | 34.7 | 29.5 |
| Elba bent cap | 11.7 | 46.3 | 43.2 | 41.2 | 35.9 | 31.1 |
| Albertville bent cap | 22.2 | 48.2 | 45.4 | 43.6 | 38.7 | 34.2 |
| Scottsboro pedestal | 37.8 | 61.7 | 59.0 | 57.5 | 53.1 | 49.6 |

The sensor depth is worth about **5 °C at 50 mm and about 17 °C even at 150 mm** - the
6 in depth DSO-12-02 instrumented at - against a disagreement of 24 to 36 °C. On
Birmingham the model still reads 29.5 °C at 150 mm against a measured 10.6 °C.

So probe placement was a real defect and it was not the main one. Peak core temperature
on these same runs is roughly right (mean absolute error 5.40 °C, item 9), so the core is
not the problem: **the modelled surface runs far too cold.** That points at the boundary -
the convective film, the sky radiation deficit, the formwork resistance, or the
evaporative term - and it points the same way as the late-peak bias in item 9, which is
also what an over-cooled element would produce. It is not diagnosed further here, and
nothing in this build corrects it.

How much the fix is worth depends entirely on how thick the section is, because the
sensor depth is a fraction of the half-thickness. On a 2 m bent cap 50 mm is a twentieth
of it and the differential barely moves - which is why the table above hardly shifts. On
the studio's own default element, a 300 mm slab, 50 mm is a third of it and the effect is
large: the probe differential is 15.40 °C against 29.03 °C at the free surface, so the
nominal probe now sits **under** the limit and only the hottest-point differential
(20.22 °C) trips it.

`season-analysis.json` is built on that same 300 mm slab, and rebuilding it after the flag
moved changed the headline outright:

| | free surface | surface sensor |
|---|---|---|
| `pct_days_breaching_cracking` at 04:00 | 100.0% | **0.0%** |
| `pct_days_breaching_cracking` at 14:00 | 100.0% | **50.0%** |
| `delta_14_minus_04` | 0.0 | **50.0** |

A statistic that read 100% at both placement hours said nothing at all. The same 30 days
against the sensor separate the two hours completely, which is the comparison the season
replay exists to make. Nothing about the weather, the element or the solver changed - only
the point the limit is read at. That is how much the measuring point was worth on a thin
section, and it is the strongest argument that the old comparison was simply wrong.

Which numbers it moves: `breaches.cracking`, `breaches.cracking_tripped_by`, and through
`n_breaches` the pour-window ranking in `best_candidate`. Read the cracking flag as
conservative, and read a cracking breach on a thick section as close to uninformative
until the surface is understood.

---

## What is solid

This belongs next to the list above because it is true and it is the reason the list is
worth reading.

**None of the five golden tests is a regression lock against this code's own output.**
Not one of them stores a number this solver produced and checks that it still produces it.

- **Golden 1** is a closed-form check. With every loss switched off the total rise is pure
  energy bookkeeping, `dT = H_u · C_c · alpha_u / (rho · c_p)`, independent of grid,
  timestep and boundary code. It is external in the strongest sense: arithmetic that would
  be true if this solver did not exist. It is also what catches the J/g → J/kg conversion,
  which is the single most dangerous unit error in the codebase.
- **Golden 2** requires monotone decay with hydration off — a physical direction, not a
  stored value.
- **Golden 3** is an exact identity, asserted to `rel=1e-12`. At constant temperature
  Nurse-Saul must return exactly `(T - T_datum) · t`, and Arrhenius equivalent age at
  exactly the reference temperature must equal elapsed time exactly. It is asserted at four
  different reference temperatures so a module-level reference cannot make it pass by
  accident. This is what catches a Celsius-to-Kelvin error in the maturity chain.
- **Golden 4** is the first law, checked every timestep: heat generated minus heat lost
  equals heat stored.
- **Golden 5** is grid convergence — halving dx must not move the peak by more than 0.1 °C.
  A self-consistency check, but between two runs, not against a stored answer.

**The Uno evaporation conversion verifies to six digits.** ACI 305.1-14's own worked
example, 0.17 lb/ft²/h, converts to 0.000230554 kg/m²/s, and the boundary code reproduces
the standard's worked evaporation rate from a 90 °F surface, 100 °F air, 56% RH and 18 mph
wind. Imperial units never escape that function.

**The boundary scheme is second order.** After the surface flux was put in series with the
half-cell of concrete between face and cell centre, the measured order on the hottest cell
is p = 2.0498 baseline, 2.0067 with the film off, and 2.0053 for the sealed adiabatic
control (`results/grid-order-20260823T211135Z-be95ada.json`).

**Latitude is a real parameter, not a caption.** It drives solar declination, sunset hour
angle and daylength, so it moves the solar term and therefore the whole
early-morning-versus-afternoon comparison.

---

## Known, unfixed, and no number moves

These are recorded for completeness. Each has been checked and none of them changes a
published result in this build.

**`ALPHA_U_CAP = 1.09`.** Two published secondary sources give 1.0 for the cap on the
ultimate degree of hydration. Ours is 1.09. It never binds: alpha_u computes to 0.8204 for
the standard mix and 0.7383 for Deer Creek, both well below either cap. The two values are
indistinguishable in every result this build produces.

**`EVAP_LIMIT_KG_M2_H = 1.0`.** The ACI 305 line is 0.2 lb/ft²/h, which is 0.976464
kg/m²/h. The constant is 1.0, so the threshold sits 2.41% loose. It changes no reported
flag: both placement hours breach the evaporation limit on every day in the sampled season,
by margins far larger than 2.4%.

**Constants lack individual source attribution.** `physics/constants.py` names the standard
a group of constants comes from — ASTM C1074, USBR DSO-12-02, Schindler & Folliard 2005,
ACI 207, ACI 305, ACI 347 — but not the page, table or equation each individual number was
read from. Several also carry a PROVISIONAL marker rather than a citation:
`BETA_DEFAULT = 0.9` ("eqn [11] SO3 exponent sign unconfirmed") and
`PLACEMENT_MAX_C = 32.0` ("ACI 305, often project-specific"). Anyone auditing a single
constant has to find it in the source themselves.
