"""ASTM C1074 maturity. Nurse-Saul and Arrhenius equivalent age."""


from physics import FloatArray

# common datum temperature and reference temperature, celsius.
DATUM_TEMP_C = 0.0
REF_TEMP_C = 23.0
GAS_CONSTANT_J_MOL_K = 8.314


# celsius in, degree-hours out. nurse-saul.
def nurse_saul_c_hours(
    temps_c: FloatArray, dt_h: float, datum_temp_c: float = DATUM_TEMP_C
) -> float:
    raise NotImplementedError


# celsius in, equivalent age out. astm c1074 arrhenius.
def equivalent_age_h(
    temps_c: FloatArray,
    dt_h: float,
    activation_energy_j_mol: float,
    ref_temp_c: float = REF_TEMP_C,
) -> float:
    raise NotImplementedError


# equivalent age to fraction of 28-day strength.
def strength_fraction(equivalent_age_h: FloatArray, mix_id: str) -> FloatArray:
    raise NotImplementedError
