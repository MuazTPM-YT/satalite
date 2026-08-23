# SPEC-04 — AMENDMENTS & RESOLVED UNCERTAINTIES

Supersedes the corresponding sections of SPEC-00-MASTER. Items marked ✅ are resolved.
⚠️ still needs a human to confirm. 🔴 is a correction to something I previously told you
that was wrong.

---

## ✅ R1 — SCM corrections to ultimate degree of hydration — **SOLVED**

Schindler & Folliard (2005), from a nonlinear regression on **352 response variables**:

```
α_u = 1.031·(w/cm) / (0.194 + w/cm)  +  0.50·p_FA  +  0.30·p_slag        ≤ 1.09
```

- `p_FA` = fly ash mass fraction of total cementitious
- `p_slag` = GGBF slag mass fraction of total cementitious
- **Both terms are POSITIVE.** I had previously guessed the slag term might be negative.
  It is not. This is why we didn't write it from memory.
- Cap is **1.09**, not 1.00 — the regression allows it because degree of hydration here is
  referenced to cement, not to total binder.

**Implement exactly as written.**

---

## ⚠️ R2 — τ and β regressions — **τ SOLVED, β NEEDS ONE CHECK**

Same source, same regression:

```
τ = 66.78 · p_C3A^(−0.154) · p_C3S^(−0.401) · Blaine^(−0.804) · p_SO3^(−0.758)
        · exp( 2.187·p_slag  +  9.50·p_FA·p_FA-CaO )

β = 181.4 · p_C3A^(0.146) · p_C3S^(0.227) · Blaine^(−0.535) · p_SO3^(−0.558)
        · exp( −0.647·p_slag )
```

`Blaine` = specific surface area of cement in **m²/kg**. All `p_` terms are mass fractions.

### τ — verified numerically ✅

For a typical Type I/II cement (p_C3A 0.08, p_C3S 0.55, Blaine 380 m²/kg, p_SO3 0.03,
no SCM):

```
τ = 66.78 × 1.476 × 1.271 × 0.008427 × 14.27  =  15.1 hours
```

That lands squarely in the expected 10–20 h band. **The units convention is confirmed:
mass fractions, Blaine in m²/kg.**

### 🔴 β — does NOT reconcile, one term is suspect

Same inputs through the β expression give **β ≈ 32.4**.

That cannot be right. An independent calibration in the literature (arXiv 2401.11988, OPC
mortar at w/c 0.30) reports **β = 0.884, τ = 30.97 h, α_u = 0.626, H_cem = 494 J/g,
E = 40,150 J/mol** — so β genuinely lives near ~0.9.

**Diagnosis:** if the `p_SO3` exponent is **+0.558** rather than −0.558, the same inputs
give **β ≈ 0.65** — plausible. So the sign on that one term is very likely transcribed
wrong in the secondary source I read.

**Razan: this is now a single-line check, not a research project.** Open the primary paper
and confirm the sign of the SO₃ exponent in the β equation only. Everything else in R2 is
verified.

Until confirmed: **use β = 0.9 as a fixed default** and expose it as a config value.

---

## ⚠️ R3 — Activation energy — **PARTIALLY RESOLVED**

ASTM C1074 gives `E = 33,500 J/mol` above 20 °C.
The independent OPC mortar calibration above fitted **E = 40,150 J/mol**.

So E *does* vary materially by mix — roughly 20% between those two figures. At 40 °C that
propagates to a meaningful difference in hydration rate.

**Decision for v1:** default to ASTM's 33,500 J/mol, expose E as a calibratable parameter,
and include it in the Monte Carlo with a range of 33,000–42,000 J/mol. That is honest and
it removes the need to resolve the question before building.

⚠️ Still worth Razan confirming Schindler's own E expression (it's a function of C3A,
C4AF, Blaine) for the "advanced" path.

---

## 🔴 R7 — Modulus lag — **I TOLD YOU THIS WRONG. Correcting it.**

I wrote in the spec: *"elastic modulus develops more slowly than compressive strength, so
early stripping can cause deflection even at correct strength."* I took that from an
Eng-Tips commenter. **The literature says otherwise.**

Actual finding (Materials 12(2):207, experimental characterisation of CEM I concretes):

> CEM I concretes develop **stiffness and strength significantly faster** than the fib
> Model Code formulas describe. The **creep modulus** evolves significantly *slower* than
> strength and stiffness. Concrete loaded at early ages is **surprisingly creep active,
> even when it appears mature in terms of strength and stiffness.**

And separately: *modulus of elasticity of young concrete exhibits a rather stable
relationship with compressive strength*, agreeing with code recommendations.

### What this means for us

| Claim | Status |
|---|---|
| "Modulus lags strength" | ❌ **Wrong.** E and f'c develop together with a stable relationship |
| "Early stripping risks deflection" | ✅ **True — but the mechanism is CREEP, not stiffness** |

Creep strains are substantially smaller when loading begins at older age, with a
many-fold reduction for later loading. ACI 318 and CEB-FIP both carry correction factors
for age at loading.

### The honest disclaimer, corrected

> *SatAlite predicts in-place compressive strength development. Elastic modulus tracks
> strength closely and can be estimated from it. However, concrete loaded at early age is
> significantly more creep-active, so long-term deflection is governed by age at loading
> as well as by strength at loading. We do not model creep. Striking decisions must
> account for it.*

That's a **narrower and more defensible** gap than what I originally wrote — and stating
the correct mechanism will read far better than repeating a forum misconception.

### We can also compute a modulus estimate — ❌ **withdrawn, see SPEC-05 [34]**

fib Model Code 2010:
```
f_c(t)   = f_c,28 · exp[ s·(1 − √(28/t)) ]              t in days
E_28     = 21.5 GPa · α · (f_c,28 / 10 MPa)^(1/3)      α = aggregate stiffness factor
```
🔴 Exponent is **1/3**, not the `0.3` this section originally printed. 4.7% at 40 MPa.

`s` depends on f_c,28 and cement type; `α` = 1.0 for quartz aggregates (and the study
found no distinction needed between quartz and limestone for this correlation).

We **could** display an estimated E(t) alongside strength. **We do not, and the stub has
been deleted.** It crosses the "not structural analysis" boundary, and the risk it appears
to answer is creep — which this same amendment establishes we do not model. Full reasoning
in SPEC-05 [34].

---

## ✅ K1 — 2D explicit FD stability with Robin BC — **DERIVED**

Let `Fo = α·Δt/Δx²` and `Bi = h_eff·Δx/k`. Stability requires the coefficient of the
node's own previous value to stay non-negative.

| Node type | Criterion |
|---|---|
| **Interior** | `Fo ≤ 1/4` |
| **Plane surface, convective** | `Fo ≤ 1 / [2·(2 + Bi)]` |
| **Exterior corner, two exposed faces** | `Fo ≤ 1 / [4·(1 + Bi)]` |

**Take the minimum across all node types present in the mesh.**

### Worked numbers, Δx = 10 mm, α = 9.2e-7 m²/s, k = 2.2 W/mK

| h_eff | Bi | Interior | Plane surface | Corner | **Governing Δt** |
|---|---|---|---|---|---|
| 10 W/m²K (still) | 0.045 | 27.2 s | 26.6 s | 26.0 s | **26 s** |
| 50 W/m²K (windy) | 0.227 | 27.2 s | 24.4 s | 22.2 s | **22 s** |

**Recommendation: Δt = 10 s.** That's ~0.4× the tightest limit across the realistic h
range, leaving margin for the hydration source term.

🔴 **Assert this at runtime, every run.** Exceeding it produces silent garbage, not a crash.

---

## ✅ K4 — Surface node update equation — **DERIVED**

Half-cell energy balance on a plane surface node (normal in x, interior neighbour `T_in`,
lateral neighbours `T_up`, `T_dn`), control volume `(Δx/2)·Δx`:

```
T_s^{n+1} = T_s^n
          + 2·Fo·(T_in − T_s^n)                        ← conduction, normal
          + Fo·(T_up + T_dn − 2·T_s^n)                 ← conduction, lateral
          + 2·Fo·Bi·(T_air − T_s^n)                    ← convection
          + 2·Fo·(q_solar − q_evap − q_rad)·Δx / k     ← other surface fluxes [W/m²]
          + Q_s·Δt / (ρ·c_p)                           ← hydration generation
```

Collecting the `T_s^n` terms gives `1 − 2·Fo·(2 + Bi)`, which reproduces the plane-surface
stability criterion above — **the two derivations are consistent, which is your check that
this is right.**

🔴 **Note the factor of 2 on the normal-conduction and convection terms.** It comes from
the half-cell volume. A ghost-node formulation misses it and produces a **2× flux error**
at every surface — the classic failure mode here, and it silently changes peak core
temperature.

Krish: verify this against Incropera Table 5.3 (finite-difference equations for nodal
points). My corner criterion in particular deserves an independent check.

---

## ⚠️ R6 — Thresholds — **PARTIALLY RESOLVED**

One useful nuance found: **ACI PRC-207.1-21 states that temperatures above the limit can
be justified when the cementitious materials meet a certain minimum SCM content.**

So the max-temperature limit is **conditional on mix composition**, not a flat number.
That is directly relevant — our fly-ash and slag inputs should modulate the threshold, not
just the heat generation.

Still open and needing Razan: the exact DEF figure (70 vs 65 °C), whether the cracking
differential is 20 °C or 19.4 °C (35 °F), and the ACI 347 strength fraction for stripping.

---

## SUMMARY OF CHANGES TO MAKE

| Where | Change |
|---|---|
| MASTER §4.3 | Replace α_u with the full R1 equation including both SCM terms |
| MASTER §4.3 | Add the τ regression (verified). Use β = 0.9 fixed until the SO₃ sign is confirmed |
| MASTER §4.4 | E defaults to 33,500 J/mol, calibratable, MC range 33,000–42,000 |
| MASTER §4.9 | Δt = 10 s. Runtime assert against `min(Fo)` over node types |
| MASTER §5 | Max-temperature threshold becomes SCM-dependent, not flat |
| MASTER §10 F1 | **Rewrite.** The gap is creep, not modulus. E(t) display cut — SPEC-05 [34] |
| SPEC-01 | K1 and K4 now answered — Muaz is unblocked on `conduction.py` |
| SPEC-02 | R1 done. R2 reduced to one sign check. R7 reframed |
| SPEC-03 | K1, K4 delivered — Krish verifies rather than derives |

---

## WHAT I COULD NOT RESOLVE

Being explicit so nobody assumes these are handled:

- **R4** — ConcreteWorks default thermal properties. Report is behind a fetch I couldn't
  complete. Our current defaults (ρ 2400, c_p 1000, k 2.2) are standard and defensible.
- **R5** — strength–maturity parameters for US grades. Not found. Likely genuinely absent
  as published per-grade sets, which is itself a finding — it strengthens the
  "calibration required" framing.
- **R6** — exact threshold figures still need a human with the standards.
- **R8** — real pour record examples. Not searched.

The β sign is the highest-value remaining item and it's a five-minute check.
