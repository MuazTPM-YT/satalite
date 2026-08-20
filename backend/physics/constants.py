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
H_CEM_DEFAULT = 470.0         # J/g if Bogue data unavailable

# ASTM C1074 switches the activation energy slope at 20 C. this is a fixed
# breakpoint in the standard, NOT the reference temperature. do not tie it to T_ref.
EA_BREAKPOINT_C = 20.0

# Schindler & Folliard 2005, regression on 352 response variables
ALPHA_U_A = 1.031
ALPHA_U_B = 0.194
ALPHA_U_FA = 0.50    # fly ash term. POSITIVE.
ALPHA_U_SLAG = 0.30  # slag term. POSITIVE.
ALPHA_U_CAP = 1.09

# ---- PROVISIONAL: pending verification, see docs/SPEC-04-AMENDMENTS.md ----
BETA_DEFAULT = 0.9      # PROVISIONAL. eqn [11] SO3 exponent sign unconfirmed
DEF_LIMIT_C = 70.0      # PROVISIONAL. 70 vs 65, SCM-dependent per ACI 207.1
CRACK_LIMIT_C = 20.0    # PROVISIONAL. 20 vs 19.4 (35F)
PLACEMENT_MAX_C = 32.0  # PROVISIONAL. ACI 305, often project-specific
STRIP_FRACTION = 0.75   # PROVISIONAL. 70-75% of f'c, ACI 347
