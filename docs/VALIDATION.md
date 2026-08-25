# SatAlite — Validation

Generated 2026-08-25T16:43:29+00:00 by `pytest validation/ -m validation`.

**1 of 3 cases meet the 90% coverage bar.**

The metric is **coverage**: the fraction of measured checkpoints that fall inside the p05–p95 band of a 300-sample Monte Carlo. It is not a point prediction, and that is deliberate. DSO-12-02 never publishes C3A, C3S, SO3 or Blaine for either cement, so a point prediction would be a test of four numbers nobody measured. What is testable is whether the published range of chemistries for the stated cement type contains what actually happened.

Point error against the ensemble median is reported under each case as a **secondary** metric. Sign convention: **predicted minus measured**, so positive means the model ran hot.

> ⚠️ **1 of 3 cases have a peak band wider than 25 °C.** A band that wide contains almost any outcome, so its coverage is weak evidence at best. Those cases are flagged inline.

Source: USBR DSO-12-02, *Thermal Properties of Reinforced Structural Mass Concrete*, Bartojay 2012. Every measured value is transcribed from a table in that report; nothing is digitized from a chart and nothing is fitted.

---

## Deer Creek spillway mix - adiabatic temperature rise

**Case id:** `deer_creek_adiabatic` &nbsp;|&nbsp; **Kind:** adiabatic

**Coverage: 100%** (1 of 1 measured checkpoints inside p05–p95) &nbsp;|&nbsp; **PASS** at the 90% bar.

Peak band width p95−p05: **23.5 °C**.

Cement type **II/V**, H_cem 470 J/g. ASSUMED chemistry ranges sampled (300 draws): blaine_m2_kg 330–390, c3a_frac 0.03–0.05, c3s_frac 0.5–0.6, so3_frac 0.02–0.03. These are typical ASTM C150 ranges for the type, **not measured values**, and they are not tuned.

Resulting tau: p05 18.9 h, p50 22.0 h, p95 25.9 h.

| Quantity | p05 | p50 | p95 | Measured | Covered |
|---|---|---|---|---|---|
| Adiabatic rise °C | 53.8 | 64.7 | 77.3 | 61.1 | yes |

Secondary — point error on the ensemble median: +3.6 °C (+5.9 %).

Derived mix parameters (not tuned — straight out of the Schindler-Folliard regressions): alpha_u = 0.738, H_u = 375487 J/kg.

Case notes:

- Silica fume (46 lb/yd3) carries no term in the Schindler-Folliard H_u formula, so its heat is unmodelled. This biases the prediction LOW, not high.
- The lab chamber struggled to hold adiabatic past ~14 days, so the measured 110 degF may be slightly conservative.

## Deer Creek spillway, placement No. 4

**Case id:** `deer_creek_p4_2008` &nbsp;|&nbsp; **Kind:** field

**Coverage: 40%** (2 of 5 measured checkpoints inside p05–p95) &nbsp;|&nbsp; **FAIL** at the 90% bar.

Peak band width p95−p05: **25.6 °C**.

> ⚠️ **This band is too wide to be evidence.** 25.6 °C at the peak exceeds the 25 °C limit, so it would contain most plausible outcomes whatever the model did. Read the coverage above as *not falsified*, not as *confirmed*.

Cement type **II/V**, H_cem 470 J/g. ASSUMED chemistry ranges sampled (300 draws): blaine_m2_kg 330–390, c3a_frac 0.03–0.05, c3s_frac 0.5–0.6, so3_frac 0.02–0.03. These are typical ASTM C150 ranges for the type, **not measured values**, and they are not tuned.

Resulting tau: p05 18.9 h, p50 22.0 h, p95 25.9 h.

| Checkpoint | p05 °C | p50 °C | p95 °C | Measured °C | Covered |
|---|---|---|---|---|---|
| 12 h | 10.7 | 21.5 | 36.6 | 48.0 | NO |
| 24 h | 22.8 | 46.9 | 71.2 | 72.0 | NO |
| 48 h | 55.4 | 71.1 | 86.7 | 73.0 | yes |
| 72 h | 61.3 | 74.0 | 87.6 | 70.0 | yes |
| 168 h | 55.1 | 64.2 | 74.5 | 46.0 | NO |
| **Peak core** | 62.0 | 74.1 | 87.6 | 74.0 | yes |

Secondary — point error on the ensemble median: peak +0.1 °C, worst checkpoint 26.5 °C.

Derived mix parameters (not tuned — straight out of the Schindler-Folliard regressions): alpha_u = 0.738, H_u = 375487 J/kg.

Case notes:

- on_ground tags the base GROUND, which the solver treats as a zero-flux face. For a bottom lift cast on rock that is an approximation, and it biases the core HIGH.
- Silica fume heat is unmodelled, biasing the prediction LOW.

## Stony Gorge Dam diaphragm wall

**Case id:** `stony_gorge_2008` &nbsp;|&nbsp; **Kind:** field

**Coverage: 40%** (2 of 5 measured checkpoints inside p05–p95) &nbsp;|&nbsp; **FAIL** at the 90% bar.

Peak band width p95−p05: **21.8 °C**.

Cement type **II**, H_cem 500 J/g. ASSUMED chemistry ranges sampled (300 draws): blaine_m2_kg 340–400, c3a_frac 0.05–0.08, c3s_frac 0.5–0.6, so3_frac 0.025–0.035. These are typical ASTM C150 ranges for the type, **not measured values**, and they are not tuned.

Resulting tau: p05 15.7 h, p50 17.9 h, p95 20.6 h.

| Checkpoint | p05 °C | p50 °C | p95 °C | Measured °C | Covered |
|---|---|---|---|---|---|
| 12 h | 7.1 | 16.9 | 31.3 | 45.0 | NO |
| 24 h | 16.0 | 38.4 | 59.6 | 62.0 | NO |
| 48 h | 46.3 | 59.4 | 72.1 | 69.0 | yes |
| 72 h | 50.6 | 60.5 | 70.6 | 64.0 | yes |
| 168 h | 39.2 | 45.1 | 52.8 | 39.0 | NO |
| **Peak core** | 50.9 | 61.0 | 72.6 | 68.9 | yes |

Secondary — point error on the ensemble median: peak -7.9 °C, worst checkpoint 28.1 °C.

Derived mix parameters (not tuned — straight out of the Schindler-Folliard regressions): alpha_u = 0.817, H_u = 397552 J/kg.

Case notes:

- FORMWORK_R has no steel/timber entry. plywood_18mm (R = 0.15) is the closest available and is warmer than bare steel, so it biases the prediction HIGH.
- Adiabatic rise for this mix at H_cem = 470 J/g is 96.2 degF, BELOW the measured field rise of 104 degF, which is physically impossible. This case is why H_CEM_DEFAULT is now 500 J/g.

---

## Limitations — read before quoting any number above

1. Cement chemistry — C3A, C3S, SO3 and Blaine fineness — is NOT reported in DSO-12-02. This is why the test is coverage and not point error. The ranges sampled are typical published ASTM C150 ranges for the stated cement type; they are ASSUMPTIONS, not measurements, and they were not narrowed or re-centred to make any case pass. The Schindler-Folliard tau regression is highly sensitive to them: tau moves from 25.8 h to 15.2 h across a plausible SO3 range alone.
2. Coverage is conditional on the reconstructed ambient. Ambient temperature is a Parton-Logan reconstruction from the reported multi-day average and maximum. No hourly series exists in the source. The daily minimum is inferred as 2*mean - max, forcing a symmetric diurnal swing that real weather does not have. This reconstruction is NOT varied by the ensemble, so its error sits OUTSIDE the band.
3. Humidity, wind, cloud cover and irradiance are not reported and are held at fixed assumed values (see validation/runner.py). They are not measurements, and they are not varied by the ensemble either.
4. Silica fume carries no term in the Schindler-Folliard ultimate-heat formula, so the Deer Creek mix has 27.3 kg/m3 of unmodelled binder. This biases the prediction LOW. Deer Creek already over-predicts, so the TRUE over-prediction is worse than the number reported here — a term for silica fume would push the band further above the measurements, not toward them. No such term has been invented to close the gap.
5. H_cem is selected by ASTM cement type (physics.constants.H_CEM_BY_TYPE: I 510, II 500, II/V 470, V 450 J/g) rather than computed from Bogue compounds, because DSO-12-02 publishes no oxide analysis. The type means are literature values; only the Type II figure is confirmed against a measurement in these cases.
6. The ensemble varies the mix, the surface film, the solar absorptivity, the placement temperature and the activation energy. It does not vary the geometry, the formwork R-value or the weather reconstruction. Those errors are outside the band.
7. The solver is 2D. Both field elements are finite in the third dimension, so the real sections lose heat this model cannot.
8. Strength is not validated here. Case 4 of the source (Table 9) needs a calibrated strength-maturity model; physics/strength_model.py is PROVISIONAL.
