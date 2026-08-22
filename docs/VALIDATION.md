# SatAlite — Validation

Generated 2026-08-22T02:23:56+00:00 by `pytest validation/ -m validation`.

**1 of 3 cases pass their stated acceptance criteria.**

Source: USBR DSO-12-02, *Thermal Properties of Reinforced Structural Mass Concrete*, Bartojay 2012. Every measured value is transcribed from a table in that report; nothing is digitized from a chart and nothing is fitted.

Error sign convention: **predicted minus measured**. Positive means the model ran hot.

---

## Deer Creek spillway mix - adiabatic temperature rise

**Case id:** `deer_creek_adiabatic` &nbsp;|&nbsp; **Kind:** adiabatic &nbsp;|&nbsp; **Verdict: PASS**

Checks: adiabatic_rise pass

| Quantity | Predicted | Measured | Error |
|---|---|---|---|
| Adiabatic rise | 69.0 °C (124.2 °F) | 61.1 °C (110.0 °F) | +12.9 % |
| Peak temperature | 85.7 °C | 77.8 °C | +7.9 °C |

Derived mix parameters (not tuned - straight out of the Schindler-Folliard regressions): alpha_u = 0.738, H_u = 398363 J/kg, tau = 20.5 h.

Case notes:

- Silica fume (46 lb/yd3) carries no term in the Schindler-Folliard H_u formula, so its heat is unmodelled. This biases the prediction LOW, not high.
- The lab chamber struggled to hold adiabatic past ~14 days, so the measured 110 degF may be slightly conservative.

## Deer Creek spillway, placement No. 4

**Case id:** `deer_creek_p4_2008` &nbsp;|&nbsp; **Kind:** field &nbsp;|&nbsp; **Verdict: FAIL**

Checks: checkpoints FAIL, peak_core_temp pass

| Checkpoint | Predicted °C | Measured °C | Error °C |
|---|---|---|---|
| 12 h | 24.0 | 48.0 | -24.0 |
| 24 h | 54.0 | 72.0 | -18.0 |
| 48 h | 75.5 | 73.0 | +2.5 |
| 72 h | 78.3 | 70.0 | +8.3 |
| 168 h | 71.9 | 46.0 | +25.9 |
| **Peak core** | 78.3 | 74.0 | +4.3 |

Predicted peak at 78.3 h; measured window not reported. Time error n/a.

Derived mix parameters (not tuned - straight out of the Schindler-Folliard regressions): alpha_u = 0.738, H_u = 398363 J/kg, tau = 20.5 h.

Case notes:

- on_ground tags the base GROUND, which the solver treats as a zero-flux face. For a bottom lift cast on rock that is an approximation, and it biases the core HIGH.
- Silica fume heat is unmodelled, biasing the prediction LOW.

## Stony Gorge Dam diaphragm wall

**Case id:** `stony_gorge_2008` &nbsp;|&nbsp; **Kind:** field &nbsp;|&nbsp; **Verdict: FAIL**

Checks: checkpoints FAIL, peak_core_temp FAIL, peak_time FAIL

| Checkpoint | Predicted °C | Measured °C | Error °C |
|---|---|---|---|
| 12 h | 15.1 | 45.0 | -29.9 |
| 24 h | 32.8 | 62.0 | -29.2 |
| 48 h | 55.7 | 69.0 | -13.3 |
| 72 h | 57.4 | 64.0 | -6.6 |
| 168 h | 42.4 | 39.0 | +3.4 |
| **Peak core** | 57.7 | 68.9 | -11.2 |

Predicted peak at 62.8 h; measured window [36, 51]. Time error +19.3 h.

Derived mix parameters (not tuned - straight out of the Schindler-Folliard regressions): alpha_u = 0.817, H_u = 397552 J/kg, tau = 21.1 h.

Case notes:

- FORMWORK_R has no steel/timber entry. plywood_18mm (R = 0.15) is the closest available and is warmer than bare steel, so it biases the prediction HIGH.
- Adiabatic rise for this mix at H_cem = 470 J/g is 96.2 degF, BELOW the measured field rise of 104 degF, which is physically impossible. This case is why H_CEM_DEFAULT is now 500 J/g.

---

## Limitations — read before quoting any number above

1. Ambient temperature is a Parton-Logan reconstruction from the reported multi-day average and maximum. No hourly series exists in the source. The daily minimum is inferred as 2*mean - max, forcing a symmetric diurnal swing that real weather does not have.
2. Humidity, wind, cloud cover and irradiance are not reported and are held at fixed assumed values (see validation/runner.py). They are not measurements.
3. Cement chemistry - C3A, C3S, SO3 and Blaine fineness - is NOT reported in DSO-12-02. The values in the case files are assumed for an ordinary Type II clinker. The Schindler-Folliard tau regression is highly sensitive to them: tau moves from 25.8 h to 15.2 h across a plausible SO3 range alone, and tau sets the whole early-age shape.
4. Silica fume carries no term in the Schindler-Folliard ultimate-heat formula, so the Deer Creek mix has 27.3 kg/m3 of unmodelled binder. This biases predictions LOW.
5. The solver is 2D. Both field elements are finite in the third dimension, so the real sections lose heat this model cannot.
6. Strength is not validated here. Case 4 of the source (Table 9) needs a calibrated strength-maturity model; physics/strength_model.py is PROVISIONAL.
