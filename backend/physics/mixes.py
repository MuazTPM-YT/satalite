"""Concrete mix library. Cement content, hydration params, thermal props."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Mix:
    mix_id: str
    cement_kg_m3: float          # C_c
    hu_j_per_g: float            # H_u, total heat of hydration
    alpha_u: float               # ultimate degree of hydration
    tau_h: float                 # hydration time parameter
    beta: float                  # hydration shape parameter
    activation_energy_j_mol: float
    density_kg_m3: float         # rho
    specific_heat_j_kg_c: float  # c_p, per celsius
    conductivity_w_m_c: float    # k, per celsius


# look up mix by id.
def get_mix(mix_id: str) -> Mix:
    raise NotImplementedError


# every mix we know.
def list_mixes() -> list[Mix]:
    raise NotImplementedError
