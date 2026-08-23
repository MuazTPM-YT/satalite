"""The half-cell balance that face_h_discrete and face_q_discrete both come from."""

import numpy as np
import pytest

from physics.equations import conduction


# what the film and the external flux deliver to the face must equal what conducts on to
# the cell centre. Both boundary terms are attenuated by the same 1/(1 + h*dx/(2k)), and
# this identity is the only thing that says so. It fails the moment either factor is
# dropped or applied twice - which is exactly the defect that dragged the observed
# convergence order to 0.82 while the q-off and h-off arms each looked mesh independent.
@pytest.mark.parametrize("h", [0.0, 1e-3, 5.0, 25.0, 400.0])
@pytest.mark.parametrize("q", [0.0, -180.0, 620.0])
@pytest.mark.parametrize("dx_m", [0.005, 0.02])
def test_boundary_terms_carry_the_same_half_cell_attenuation(
    h: float, q: float, dx_m: float
) -> None:
    k_w_m_k, air_temp_c, centre_temp_c = 2.2, 37.0, 61.5

    face_c = conduction.face_temp_c(
        np.float64(centre_temp_c), air_temp_c, h, q, dx_m, k_w_m_k
    )
    conducted_w_m2 = (2.0 * k_w_m_k / dx_m) * (float(face_c) - centre_temp_c)

    delivered_w_m2 = float(
        conduction.face_h_discrete(h, dx_m, k_w_m_k)
    ) * (air_temp_c - centre_temp_c) + float(
        conduction.face_q_discrete(q, h, dx_m, k_w_m_k)
    )

    assert conducted_w_m2 == pytest.approx(delivered_w_m2, rel=1e-12, abs=1e-9)


# a sealed face passes nothing on, whatever flux is nominally sitting on it.
def test_zero_film_leaves_only_the_flux_term() -> None:
    assert float(conduction.face_q_discrete(500.0, 0.0, 0.02, 2.2)) == 500.0
