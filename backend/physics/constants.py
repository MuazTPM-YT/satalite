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
    # Most US general-purpose cement is sold as I/II, and refusing the designation forced
    # every such mix to be relabelled before it could be solved at all. Placed between I
    # and II the way II/V sits between II and V, rather than collapsed onto either end.
    # The competing argument is that a I/II is bound by Type II's C3A ceiling and should
    # therefore read a flat 500; the two differ by 1%, which is about 0.1 degC on peak
    # core, and the ensemble samples wider than that. Send "II" if you mean Type II.
    "I/II": 505.0,
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
