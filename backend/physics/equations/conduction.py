"""2D masked heat conduction, explicit cell-centred finite volume.

Cell-centred, NOT half-cell nodes. Every solid cell is a full dx*dx control volume and
each of its four faces carries a flux. Half-cell node placement is fiddly and easy to get
wrong on masked geometry like T- and L-sections; this formulation is identical for every
cell whatever the mask looks like.

Trade-off, stated plainly: the "surface temperature" reported by this scheme is the
boundary CELL CENTRE, offset dx/2 inside the true surface. First-order accurate. At
dx = 10 mm that is a fraction of a degree and acceptable; it is not exact.

Boundary conditions arrive already summed over each cell's exterior faces - h_sum is
sum(h_face) and q_sum is sum(q_face) - so a corner cell with two open faces carries
twice the coefficient of a flat one. Everything is per unit depth: cell volume dx*dx*1,
face area dx*1.
"""

from dataclasses import dataclass

import numpy as np

from physics import BoolArray, FloatArray

# same direction order as geometry.face_tags
UP, DOWN, LEFT, RIGHT = 0, 1, 2, 3


class TimestepTooLargeError(RuntimeError):
    """Explicit schemes do not crash when dt is too big - they produce smooth garbage."""


@dataclass(frozen=True)
class StepResult:
    """One timestep, with the energy terms golden test 4 checks. Joules per unit depth."""

    temp_c: FloatArray
    heat_generated_j: float
    heat_stored_j: float
    heat_lost_j: float


# surface film in series with the half cell of concrete between face and cell centre.
#
# The cell centre sits dx/2 inside the surface, so heat leaving the cell crosses dx/(2k)
# of concrete before it ever reaches the film. Applying h to the centre temperature alone
# overstates the loss and drags the scheme down to first order at the boundary. Must be
# applied PER FACE, before the faces of a cell are summed - the series combination of a
# sum is not the sum of the series combinations.
def face_h_discrete(h_face_w_m2_k: FloatArray | float, dx_m: float, k_w_m_k: float) -> FloatArray:
    h = np.asarray(h_face_w_m2_k, dtype=np.float64)
    return np.asarray(h / (1.0 + h * dx_m / (2.0 * k_w_m_k)), dtype=np.float64)


# the SAME series attenuation, applied to an externally imposed face flux.
#
# From the identical half-cell balance. Solving it for what actually reaches the centre:
#     (2k/dx)*(T_face - T_centre) = [h*(T_air - T_centre) + q] / (1 + h*dx/(2k))
# so q carries exactly the factor h does. Attenuating h and passing q raw leaves a
# residual of q*h*dx/(2k) - first order in dx, and it needs BOTH terms to be non-zero.
# That is what the arm sweep measured: baseline p = 0.82, but the q-off arm and the
# h-off arm were each mesh independent, and halving q raised p from 1.31 to 1.56.
def face_q_discrete(
    q_face_w_m2: FloatArray | float,
    h_face_w_m2_k: FloatArray | float,
    dx_m: float,
    k_w_m_k: float,
) -> FloatArray:
    h = np.asarray(h_face_w_m2_k, dtype=np.float64)
    q = np.asarray(q_face_w_m2, dtype=np.float64)
    return np.asarray(q / (1.0 + h * dx_m / (2.0 * k_w_m_k)), dtype=np.float64)


# cell centre back out to the true face temperature. celsius in, celsius out.
#
# Steady balance across the half cell: what the film and the external flux deliver to the
# face must equal what conducts on to the centre.
#     h*(T_air - T_face) + q_ext = (2k/dx)*(T_face - T_centre)
# Worth the four lines because Uno evaporation goes as T**2.5, so feeding it a centre
# temperature dx/2 off the surface is an O(dx) error big enough to break grid convergence.
def face_temp_c(
    centre_temp_c: FloatArray,
    air_temp_c: FloatArray | float,
    h_film_w_m2_k: FloatArray | float,
    q_ext_w_m2: FloatArray | float,
    dx_m: float,
    k_w_m_k: float,
) -> FloatArray:
    half_cell = 2.0 * k_w_m_k / dx_m
    film = np.asarray(h_film_w_m2_k, dtype=np.float64)
    numerator = film * np.asarray(air_temp_c) + np.asarray(q_ext_w_m2) + half_cell * centre_temp_c
    return np.asarray(numerator / (film + half_cell), dtype=np.float64)


# how many of each solid cell's four neighbours are also solid.
def neighbour_counts(mask: BoolArray) -> FloatArray:
    pad = np.pad(mask, 1, constant_values=False)
    total = (
        pad[2:, 1:-1].astype(np.int8)
        + pad[:-2, 1:-1]
        + pad[1:-1, :-2]
        + pad[1:-1, 2:]
    )
    return np.asarray(np.where(mask, total, 0), dtype=np.float64)


# biggest stable dt, seconds. derived from the update's own T coefficient, not hardcoded.
#
# T_new = T*(1 - Fo*(n_solid + (dx/k)*h_sum)) + ...  so that coefficient must stay >= 0.
# for interior cells n_solid = 4, giving the familiar Fo <= 1/4.
def max_stable_dt_s(
    mask: BoolArray,
    h_sum_w_m2_k: FloatArray,
    dx_m: float,
    alpha_m2_s: float,
    k_w_m_k: float,
) -> float:
    load = neighbour_counts(mask) + (dx_m / k_w_m_k) * np.asarray(h_sum_w_m2_k)
    worst = float(load[mask].max()) if mask.any() else 4.0
    return dx_m**2 / (alpha_m2_s * max(worst, 1e-12))


# blow up loudly instead of returning smooth nonsense. trap 2.
def assert_stable(
    dt_s: float,
    mask: BoolArray,
    h_sum_w_m2_k: FloatArray,
    dx_m: float,
    alpha_m2_s: float,
    k_w_m_k: float,
) -> float:
    limit_s = max_stable_dt_s(mask, h_sum_w_m2_k, dx_m, alpha_m2_s, k_w_m_k)
    if dt_s > limit_s:
        raise TimestepTooLargeError(
            f"dt={dt_s:g} s exceeds the explicit stability limit {limit_s:.3f} s "
            f"for dx={dx_m:g} m, alpha={alpha_m2_s:.3g} m2/s. "
            f"Reduce dt below {limit_s:.3f} s or coarsen the grid."
        )
    return limit_s


# march one timestep. celsius in, celsius out.
def step(
    temp_c: FloatArray,
    mask: BoolArray,
    n_solid: FloatArray,
    h_sum_w_m2_k: FloatArray,
    q_sum_w_m2: FloatArray,
    air_temp_c: FloatArray | float,
    source_w_m3: FloatArray,
    dx_m: float,
    dt_s: float,
    rho_kg_m3: float,
    cp_j_kg_k: float,
    k_w_m_k: float,
    account_energy: bool = True,
    outside_fill: float = np.nan,
) -> StepResult:
    alpha_m2_s = k_w_m_k / (rho_kg_m3 * cp_j_kg_k)
    fo = alpha_m2_s * dt_s / dx_m**2
    lam = dx_m / k_w_m_k  # m2K/W, turns a surface coefficient into a Fo-compatible weight

    t = np.where(mask, temp_c, 0.0)
    pad = np.zeros((t.shape[0] + 2, t.shape[1] + 2), dtype=np.float64)
    pad[1:-1, 1:-1] = t

    # t is zero outside the mask, so summing all four padded neighbours is identical to
    # summing only the solid ones - and n_solid*t supplies the matching -T terms.
    # Built in place: this loop runs tens of thousands of times and every full-field
    # temporary costs real wall clock.
    delta_c = pad[2:, 1:-1] + pad[:-2, 1:-1]
    delta_c += pad[1:-1, :-2]
    delta_c += pad[1:-1, 2:]
    delta_c -= n_solid * t

    gain_w_m2 = h_sum_w_m2_k * (np.asarray(air_temp_c) - t)
    gain_w_m2 += q_sum_w_m2

    delta_c += lam * gain_w_m2
    delta_c *= fo
    delta_c += source_w_m3 * (dt_s / (rho_kg_m3 * cp_j_kg_k))
    new_c = np.where(mask, temp_c + delta_c, outside_fill)

    # only golden test 4 needs the joule bookkeeping, and its three masked reductions
    # are a fifth of the step cost. The solver switches them off.
    if not account_energy:
        return StepResult(np.asarray(new_c, dtype=np.float64), 0.0, 0.0, 0.0)

    return StepResult(
        temp_c=np.asarray(new_c, dtype=np.float64),
        heat_generated_j=float(source_w_m3[mask].sum()) * dx_m**2 * dt_s,
        heat_stored_j=float(delta_c[mask].sum()) * rho_kg_m3 * cp_j_kg_k * dx_m**2,
        heat_lost_j=-float(gain_w_m2[mask].sum()) * dx_m * dt_s,
    )
