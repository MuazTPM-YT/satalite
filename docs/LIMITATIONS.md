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
