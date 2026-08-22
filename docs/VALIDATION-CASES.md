# SatAlite — Validation Cases

**Source:** USBR DSO-12-02, *Thermal Properties of Reinforced Structural Mass Concrete*,
Bartojay 2012. `https://www.usbr.gov/damsafety/TechDev/DSOTechDev/DSO-12-02.pdf`

Every number below is from **tables in the report**, not digitized from charts.
Public domain, US Bureau of Reclamation.

---

# HOW THIS WORKS (the answer to "do you give me a command?")

No. There's no command, because the data lives in PDFs. The mechanism is:

```
backend/validation/
├── cases/
│   ├── stony_gorge_2008.yaml       ← inputs + ground truth, transcribed by hand once
│   ├── deer_creek_p4_2008.yaml
│   └── deer_creek_adiabatic.yaml
├── runner.py                        ← loads case, runs solver, compares
└── report.py                        ← writes docs/VALIDATION.md
```

You transcribe each case **once** into YAML. `runner.py` then does:

```
load case → build Mix + Element → synthesise ambient from the reported
average/max → run solver → compare predicted vs measured at the
reported checkpoints → emit error table
```

Run it as `pytest validation/` so it lives with the rest of the suite.

⚠️ **Ambient is the weak link.** These reports give average and maximum ambient, not an
hourly series. Reconstruct a diurnal curve from those two numbers (you already have
Parton–Logan) and **state that as a limitation.** It's an approximation, and saying so is
better than pretending otherwise.

---

# ⭐ CASE 1 — ADIABATIC TEMPERATURE RISE (do this first)

The cleanest possible test. Lab-measured under USBR 4911, **no boundary conditions at
all** — it validates the entire hydration chain in isolation.

## Inputs — Deer Creek Dam Spillway mix

| Parameter | Value | SI |
|---|---|---|
| Cement, Type II/V | 735 lb/yd³ | 436.1 kg/m³ |
| Class F fly ash | 183 lb/yd³ | 108.6 kg/m³ |
| Silica fume | 46 lb/yd³ | 27.3 kg/m³ |
| **Total cementitious** | **964 lb/yd³** | **571.9 kg/m³** |
| Water | 310 lb/yd³ | 183.9 kg/m³ |
| **w/cm** | — | **0.322** |
| Sand | 710 lb/yd³ | 421.2 kg/m³ |
| Coarse aggregate | 1830 lb/yd³ | 1085.7 kg/m³ |
| NMSA | 1 in | 25 mm |
| Air (pressure meter) | 5.3% | — |
| Initial temperature | 62 °F | 16.7 °C |

## ✅ Ground truth

> <cite index="32-1">The adiabatic temperature rise was found to be 110 °F and with a peak temperature of 172 °F.</cite>

**Measured adiabatic rise: 110 °F = 61.1 °C**

## My hand-calculation — you should reproduce this

```
p_cem = 735/964 = 0.762     p_FA = 183/964 = 0.190
α_u  = 1.031(0.322)/(0.194+0.322) + 0.50(0.190) = 0.643 + 0.095 = 0.738
H_u  = 470(0.762) + 1800(0.05)(0.190) = 375.2 J/g = 375,200 J/kg
ΔT   = 375,200 × 571.9 × 0.738 / (2400 × 1000) = 66.0 °C = 118.8 °F
```

**Predicted 118.8 °F vs measured 110 °F → +8.0%**

For a first-principles prediction with an assumed `H_cem` and no silica-fume term, that's
a genuinely good result. Two known reasons it runs high:

1. 🔴 **Silica fume isn't in the Schindler `H_u` formula.** 46 lb/yd³ is unaccounted for.
   Note this as a model gap.
2. The lab chamber struggled to hold adiabatic above ~14 days, so the measured value may
   be slightly conservative.

---

# CASE 2 — STONY GORGE DAM DIAPHRAGM WALL

Cleanest **field** case: single isolated placement, no adjacent lifts.

## Geometry & conditions

| | |
|---|---|
| Element | Diaphragm wall, **6 ft thick × 14 ft wide × 12 ft high** (1.83 × 4.27 × 3.66 m) |
| Placed | 24 April 2008, ~09:00 |
| **Placement temperature** | **52 °F = 11.1 °C** |
| Average ambient (7 d) | 63 °F = 17.2 °C |
| Max ambient (7 d) | 89.6 °F = 32 °C |
| Formwork | Steel/timber forms in place through the period |

## Mix

| | lb/yd³ | kg/m³ |
|---|---|---|
| Cement Type II | 529 | 313.8 |
| Class F fly ash | 176 | 104.4 |
| **Total cementitious** | **705** | **418.3** |
| Water | 280 | 166.1 |
| Sand | 1405 | 833.6 |
| Coarse agg | 1535 | 910.7 |
| **w/cm** | | **0.397** |
| NMSA | 1.5 in | 38 mm |
| Air | 4.4% | |

## ✅ Ground truth — Table 2, °F

| Sensor | 12 h | 24 h | 48 h | 72 h | 168 h | **Max** |
|---|---|---|---|---|---|---|
| **Center** | 113.0 | 143.6 | 156.2 | 147.2 | 102.2 | **156.2** |
| 21" from buttress 28 | 107.6 | 131.0 | 132.8 | 123.8 | 89.6 | 134.6 |
| 6" from top face | 95.0 | 113.0 | 105.8 | 96.8 | 75.2 | 113.0 |
| 18" from top face | 105.8 | 132.8 | 129.2 | 116.6 | 82.4 | 134.6 |
| 18" from bottom | 109.4 | 134.6 | 140.0 | 129.2 | 93.2 | 140.0 |
| 6" from u/s form | 93.2 | 113.0 | 107.6 | 100.4 | 78.8 | 113.0 |
| 18" from d/s form | 111.2 | 138.2 | 143.6 | 134.6 | 98.6 | 145.4 |

**Peak 156.2 °F (68.9 °C) at 36–51 h. Max rise 104 °F (57.8 °C).**
Gradients: <cite index="32-1">concrete 6 inches from the surface exceeded the 35 °F differential against the centre for all three sensors, with maximum differentials of 41 to 52 °F.</cite>

## Strength ground truth (QA cylinders, fog cured)

| Age | psi | MPa |
|---|---|---|
| 7 d | 3370 | 23.2 |
| 28 d | 4620 | 31.9 |
| 90 d | 5740 | 39.6 |

## 🔴 A finding you should act on

My adiabatic calc for this mix gives **96.2 °F**, but the **field** rise was **104 °F** —
higher than predicted adiabatic, which is physically impossible.

Back-solving: to reach 104 °F rise you need `H_cem ≈ 510 J/g`, not 470.

The report explains why: <cite index="32-1">Type IV cements are less available and overall cement fineness has increased over the years to result in more heat output per unit of cement.</cite>

**Raise `H_CEM_DEFAULT` from 470 to ~500 J/g for modern Type II**, and put the range in the
Monte Carlo. This is a real calibration finding from real data.

---

# CASE 3 — DEER CREEK SPILLWAY, PLACEMENT No. 4

Bottom lift, so no heat contribution from below. Mix as Case 1.

| | |
|---|---|
| Element | Buttress, **~6.5 ft thick × 7.5–12.5 ft high**, 11 ft between counterforts |
| Placed | 25 April 2008 |
| **Placement temperature** | **57 °F = 13.9 °C** |
| Average ambient | 50 °F = 10 °C |
| Thermal blankets | Yes — treat as insulated formwork |

## ✅ Ground truth — Table 4, °F

| Sensor | 12 h | 24 h | 48 h | 72 h | 168 h | **Max** |
|---|---|---|---|---|---|---|
| **Center** | 118.4 | 161.6 | 163.4 | 158.0 | 114.8 | **165.2** |
| 6" from top face | 111.2 | 132.8 | 118.4 | 107.6 | 73.4 | 134.6 |
| 6" from bottom face | 66.2 | 98.6 | 105.8 | 100.4 | 82.4 | 105.8 |
| 6" from interior face | 71.6 | 107.6 | 116.6 | 114.8 | 93.2 | 116.6 |
| 6" from exterior face | 105.8 | 141.8 | 145.4 | 138.2 | 89.6 | 147.2 |
| Ambient sun | 41.0 | 86.0 | 75.2 | 78.8 | 71.6 | 98.6 |
| Ambient shade | 44.6 | 48.2 | 46.4 | 60.8 | 46.4 | 73.4 |

**Peak 165.2 °F (74 °C). Max rise 113 °F (62.8 °C).**

⚠️ **Do not use Placements No. 6 or No. 8.** Both were affected by the lift below —
<cite index="32-1">placement No. 4 provided both insulation for and heat addition to placement No. 6, increasing its centre peak temperature by about 13 °F.</cite> Multi-lift coupling
is outside our model.

---

# ⭐ CASE 4 — THE STRENGTH TEST (needs R5)

The rarest data in the whole report, and exactly what validates maturity→strength.

Same mix, cured **three ways**: fog (standard), adiabatic, and a chamber programmed to
**replay the actual field temperature curve**.

## ✅ Ground truth — Table 9, psi

| Age | Simulated in-situ | Adiabatic | Fog 4×8 | Fog 6×12 |
|---|---|---|---|---|
| 12 h | 2433 | — | — | — |
| 24 h | 5170 | 4013 | 2920 | 2850 |
| 3 d | 6177 | 6837 | 4590 | 4150 |
| 7 d | 6330 | 6477 | 5170 | 4850 |
| 14 d | 6473 | 6947 | 6220 | — |
| 28 d | 6343 | 6543 | 6550 | 6810 |
| 90 d | 6313 | 7100 | 7450 | 7590 |

**This table is your entire thesis in one place:**

- At 24 h the in-situ cured concrete is **77% stronger** than the fog-cured cylinder
  (5170 vs 2920 psi). The cube in the tank badly understates the real element early on.
- By 90 d the in-situ concrete is **15% weaker** (6313 vs 7450). That's the **crossover
  effect**, measured.
- <cite index="32-1">The average 3-day compressive strength for the in-situ cured concrete is comparable to the average fog-cured 28-day compressive strength.</cite>

**Three days versus twenty-eight.** That single sentence, from a US federal report, is the
most quotable evidence you will find for this project.

Modulus is in Table 10 if you implement E(t).

---

# WHAT THIS REPORT ALSO SETTLES (retire two PROVISIONALs)

**DEF threshold — 155 °F, not 70 °C.** <cite index="32-1">DEF is caused by the melting of ettringite at temperatures above about 158 °F</cite>, and Reclamation specifies a design
maximum of **155 °F (68.3 °C)**. So `DEF_LIMIT_C = 68.3`, not 70.

⚠️ And it's **conditional on chemistry**, not absolute: <cite index="32-1">cementitious combinations containing less than 0.7% S̄/A and less than 2.0% S̄²/A were less susceptible to DEF.</cite> Both Deer Creek placements exceeded 155 °F and DEF was ruled out on that
basis. Model the threshold as chemistry-dependent.

**Cracking differential — 35 °F = 19.4 °C.** <cite index="32-1">The temperature gradients of unreinforced mass concrete sections are normally limited to about 35 °F.</cite> Confirmed
by GDOT's own wording, which uses 35 °F (19.4 °C) with a prescriptive 20 °C in
specification. **Use 19.4 °C** and note the 20 °C prescriptive variant.

---

# ACCEPTANCE CRITERIA

| Metric | Target | Stretch |
|---|---|---|
| Adiabatic rise (Case 1) | ±15% | ±8% |
| Peak core temperature | ±5 °C | ±3 °C |
| Time to peak | ±8 h | ±4 h |
| Temperature at 24/48/72 h checkpoints | ±5 °C | ±3 °C |
| Core−surface differential | ±5 °C | ±3 °C |

🔴 **Report every case you run, including failures.** Three cases with honest error bars
beats one cherry-picked match, and a judge who spots selective reporting discounts
everything else.

---

# OTHER SOURCES — status

| Source | Verdict |
|---|---|
| **USBR DSO-12-02** | ✅ **Fully extracted above. Use this.** |
| GDOT 19-04 Phase II | ⚠️ Temperature data is in **Figure 52**, not a table. Needs WebPlotDigitizer |
| FHWA mcl0202 | ⚠️ Not fetched. Has strength at 2/7/14/28/56 d, placement 70 °F, ambient 60 °F |
| Iowa DOT case study | ⚠️ The link I gave earlier was a spec document, not the paper. My error |
| Auburn HRC 930-860R | ⚠️ Not fetched. Useful for a published ConcreteWorks accuracy benchmark |

**Do Cases 1–3 first.** They're transcribable in an hour and require no digitization. If
they pass, you have your validation slide and everything else is optional.
