"""Schindler-Folliard hydration model. Heat source term for the solver."""


from physics import FloatArray
from physics.mixes import Mix


# degree of hydration at a given equivalent age.
def degree_of_hydration(mix: Mix, equivalent_age_h: FloatArray) -> FloatArray:
    raise NotImplementedError


# heat generation rate, W/m3. celsius in for the rate multiplier.
def heat_generation_w_m3(
    mix: Mix, equivalent_age_h: FloatArray, temp_c: FloatArray
) -> FloatArray:
    raise NotImplementedError


# total adiabatic rise the mix can ever deliver, celsius.
def adiabatic_rise_c(mix: Mix) -> float:
    raise NotImplementedError
