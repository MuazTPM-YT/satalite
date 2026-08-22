"""Orchestrates the timestep loop. The only stateful thing in physics/."""

import numpy as np
from scipy import ndimage

from physics import FloatArray
from physics.constants import LATENT_HEAT_VAP, SOLAR_ABSORPTIVITY, T_REF_DEFAULT_C
from physics.equations import boundary, conduction, hydration, maturity
from physics.geometry import EXPOSED, FORMED, Section, rasterize
from physics.types import Ambient, Element, Mix, SolveResult


# every weather-only quantity, resampled onto the timestep grid before the loop starts.
def _weather_per_step(
    ambient: Ambient, times_h: FloatArray, solar_absorptivity: float
) -> dict[str, FloatArray]:
    def at(values: FloatArray) -> FloatArray:
        return np.asarray(np.interp(times_h, ambient.hours, values), dtype=np.float64)

    air_temp_c = at(ambient.air_temp_c)
    cloud_pct = at(ambient.cloud_pct)
    wind_ms = at(ambient.wind_ms)
    return {
        "air_temp_c": air_temp_c,
        "rh_frac": at(ambient.rh_frac),
        "wind_ms": wind_ms,
        "sky_temp_c": boundary.sky_temperature_c(air_temp_c, cloud_pct, ambient.sky_offset_c),
        "h_conv": boundary.h_convective(wind_ms),
        "q_solar_w_m2": boundary.absorbed_solar_w_m2(
            at(ambient.ghi_w_m2), cloud_pct, solar_absorptivity
        ),
    }


# strictly conservative surface coefficient, used only to bound the stability limit.
def _worst_case_h_sum(
    section: Section, ambient: Ambient, h_multiplier: float = 1.0
) -> FloatArray:
    h_conv = float(boundary.h_convective(float(np.max(ambient.wind_ms))))
    sky_c = float(np.min(boundary.sky_temperature_c(ambient.air_temp_c, ambient.cloud_pct)))
    h_rad = float(boundary.h_radiative(90.0, sky_c))  # 90 C surface is far above any real pour
    h_max = float(boundary.h_effective(h_conv, h_rad, 0.0))  # bare: formwork only ever reduces
    return np.asarray(
        (section.face_tags != 0).sum(axis=0) * h_max * h_multiplier, dtype=np.float64
    )


# element, mix and weather in. full thermal and maturity history out.
def solve(
    element: Element,
    mix: Mix,
    ambient: Ambient,
    dt_s: float = 10.0,
    hours: float = 72.0,
    record_every_s: float = 600.0,
    t_ref_c: float = T_REF_DEFAULT_C,
    solar_absorptivity: float = SOLAR_ABSORPTIVITY,
    evaporative_cooling: bool = True,
    adiabatic: bool = False,
    h_multiplier: float = 1.0,
) -> SolveResult:
    section = rasterize(element.shape, element.dims_mm, element.dx_m, element.on_ground)
    mask, tags, dx_m = section.mask, section.face_tags, section.dx_m
    n_solid = conduction.neighbour_counts(mask)

    n_steps = int(round(hours * 3600.0 / dt_s))
    step_times_h = np.arange(n_steps, dtype=np.float64) * dt_s / 3600.0
    weather = _weather_per_step(ambient, step_times_h, solar_absorptivity)

    # trap 2: an explicit scheme past its limit produces smooth garbage, never a crash.
    conduction.assert_stable(
        dt_s,
        mask,
        np.zeros_like(n_solid)
        if adiabatic
        else _worst_case_h_sum(section, ambient, h_multiplier),
        dx_m,
        mix.alpha_m2_s,
        mix.k_w_m_k,
    )

    # faces per cell, by kind. adiabatic seals every one of them.
    # GROUND faces (on_ground=True) are intentionally excluded: the subgrade is a
    # massive thermal buffer with high contact resistance, so adiabatic is conservative
    # for peak temperature prediction. this matches the t_eq = 2t convention in the spec.
    n_exposed = np.zeros(mask.shape, dtype=np.float64)
    n_formed = np.zeros(mask.shape, dtype=np.float64)
    if not adiabatic:
        n_exposed = (tags == EXPOSED).sum(axis=0).astype(np.float64)
        n_formed = (tags == FORMED).sum(axis=0).astype(np.float64)
    surf_rows, surf_cols = np.nonzero((tags == EXPOSED).any(axis=0))
    # every cell with an exterior face, even under adiabatic, so the free surface can
    # still be reported. adiabatic zeroes the face counts, which zeroes every flux.
    boundary_rows, boundary_cols = np.nonzero((tags != 0).any(axis=0))
    formwork_r = boundary.FORMWORK_R[element.formwork]

    n_exposed_b = n_exposed[boundary_rows, boundary_cols]
    n_formed_b = n_formed[boundary_rows, boundary_cols]
    n_exposed_s = n_exposed[surf_rows, surf_cols]

    # free-surface cells are a subset of boundary cells. this maps one index into the other.
    order = np.zeros(mask.shape, dtype=np.int64)
    order[boundary_rows, boundary_cols] = np.arange(boundary_rows.size)
    exposed_in_boundary = order[surf_rows, surf_cols]

    # core = the cell furthest from any face; surface = the mean over open-faced cells.
    depth = ndimage.distance_transform_edt(np.pad(mask, 1))[1:-1, 1:-1]
    core_ij = np.unravel_index(int(np.argmax(np.where(mask, depth, -1.0))), mask.shape)

    # 0 outside the mask, not nan: the hydration and maturity terms are evaluated over
    # the whole array and nan would poison the in-place source assembly. Frames are
    # nan-filled at record time, which is what the API and the tests actually see.
    temp_c = np.where(mask, element.placement_temp_c, 0.0).astype(np.float64)
    t_e_h = np.zeros(mask.shape, dtype=np.float64)
    h_sum = np.zeros(mask.shape, dtype=np.float64)
    q_sum = np.zeros(mask.shape, dtype=np.float64)
    heat_scale = mix.h_u_j_per_kg * mix.cement_kg_m3 / 3600.0
    q_face_w_m2 = np.zeros(surf_rows.size, dtype=np.float64)

    record_every = max(int(round(record_every_s / dt_s)), 1)
    frames_c: list[FloatArray] = []
    frames_te: list[FloatArray] = []
    frame_times_h: list[float] = []
    core_c: list[float] = []
    surface_c: list[float] = []
    dt_h = dt_s / 3600.0

    for i in range(n_steps):
        air_temp_c = float(weather["air_temp_c"][i])

        # surface films, evaluated only on cells that actually have an exterior face.
        # h_rad uses the cell centre: it is cubic in kelvin, so a dx/2 offset moves it
        # by well under a percent. Uno evaporation below is the one that cannot take it.
        h_rad_b = boundary.h_radiative(
            temp_c[boundary_rows, boundary_cols], float(weather["sky_temp_c"][i])
        )
        h_conv = float(weather["h_conv"][i])
        film_open = boundary.h_effective(h_conv, h_rad_b, 0.0) * h_multiplier
        h_sum[boundary_rows, boundary_cols] = n_exposed_b * conduction.face_h_discrete(
            film_open, dx_m, mix.k_w_m_k
        ) + n_formed_b * conduction.face_h_discrete(
            boundary.h_effective(h_conv, h_rad_b, formwork_r) * h_multiplier,
            dx_m,
            mix.k_w_m_k,
        )

        # true free-surface temperature, reconstructed from the cell centre. q lags one
        # step, which at dt = 10 s against a slowly varying latent flux is immaterial.
        surf_temp_c = conduction.face_temp_c(
            temp_c[surf_rows, surf_cols],
            air_temp_c,
            film_open[exposed_in_boundary],
            q_face_w_m2,
            dx_m,
            mix.k_w_m_k,
        )

        # solar in, evaporative latent heat out, sky radiation deficit. free surface only.
        q_face_w_m2 = np.full(surf_rows.size, float(weather["q_solar_w_m2"][i]))
        if evaporative_cooling:
            q_face_w_m2 = q_face_w_m2 - LATENT_HEAT_VAP * boundary.evaporation_rate_kg_m2_s(
                surf_temp_c, air_temp_c, float(weather["rh_frac"][i]), float(weather["wind_ms"][i])
            )
        # h_rad is linearised around T_sky but conduction.step drives h_sum against T_air.
        # the missing (T_sky - T_air) offset is a fixed flux, like solar. ~37 W/m2 on
        # clear nights; zero when overcast. formed faces see formwork, not sky directly.
        q_face_w_m2 += h_rad_b[exposed_in_boundary] * (
            float(weather["sky_temp_c"][i]) - air_temp_c
        )
        q_sum[surf_rows, surf_cols] = n_exposed_s * q_face_w_m2

        if i % record_every == 0:
            frames_c.append(np.where(mask, temp_c, np.nan))
            frames_te.append(np.where(mask, t_e_h, np.nan))
            frame_times_h.append(float(step_times_h[i]))
            core_c.append(float(temp_c[core_ij]))
            surface_c.append(float(surf_temp_c.mean()))

        # the maturity clock and the hydration heat share one rate multiplier evaluation.
        rate = maturity.rate_multiplier(temp_c, t_ref_c)
        source_w_m3 = hydration.d_alpha_d_te(t_e_h, mix.alpha_u, mix.tau_h, mix.beta)
        source_w_m3 *= rate
        source_w_m3 *= heat_scale
        source_w_m3 *= mask

        temp_c = conduction.step(
            temp_c=temp_c,
            mask=mask,
            n_solid=n_solid,
            h_sum_w_m2_k=h_sum,
            q_sum_w_m2=q_sum,
            air_temp_c=air_temp_c,
            source_w_m3=source_w_m3,
            dx_m=dx_m,
            dt_s=dt_s,
            rho_kg_m3=mix.rho_kg_m3,
            cp_j_kg_k=mix.cp_j_kg_k,
            k_w_m_k=mix.k_w_m_k,
            account_energy=False,
            outside_fill=0.0,
        ).temp_c
        t_e_h += rate * dt_h

    frames_c.append(np.where(mask, temp_c, np.nan))
    frames_te.append(np.where(mask, t_e_h, np.nan))
    frame_times_h.append(hours)
    core_c.append(float(temp_c[core_ij]))
    # reconstruct the true face temperature, same as the loop body does, so the last
    # entry in surface_c is consistent with all the others (cell centre != surface).
    final_surf_temp_c = conduction.face_temp_c(
        temp_c[surf_rows, surf_cols],
        air_temp_c,
        film_open[exposed_in_boundary],
        q_face_w_m2,
        dx_m,
        mix.k_w_m_k,
    )
    surface_c.append(float(final_surf_temp_c.mean()))

    core_arr = np.asarray(core_c, dtype=np.float64)
    surface_arr = np.asarray(surface_c, dtype=np.float64)
    times_arr = np.asarray(frame_times_h, dtype=np.float64)
    peak_i = int(np.argmax(core_arr))

    return SolveResult(
        times_h=times_arr,
        temp_c_frames=np.asarray(frames_c, dtype=np.float64),
        t_e_h_frames=np.asarray(frames_te, dtype=np.float64),
        core_temp_c=core_arr,
        surface_temp_c=surface_arr,
        peak_core_temp_c=float(core_arr[peak_i]),
        peak_core_time_h=float(times_arr[peak_i]),
        max_core_surface_diff_c=float(np.max(core_arr - surface_arr)),
        dt_s=dt_s,
        outline_m=section.outline_m,
    )


# constant weather, no sun, no wind. what golden tests 1, 2 and 5 run against.
def uniform_ambient(
    air_temp_c: float,
    hours: float,
    rh_frac: float = 0.5,
    wind_ms: float = 0.0,
    cloud_pct: float = 100.0,
    ghi_w_m2: float = 0.0,
) -> Ambient:
    ones = np.ones(2, dtype=np.float64)
    return Ambient(
        hours=np.array([0.0, hours], dtype=np.float64),
        air_temp_c=ones * air_temp_c,
        rh_frac=ones * rh_frac,
        wind_ms=ones * wind_ms,
        cloud_pct=ones * cloud_pct,
        ghi_w_m2=ones * ghi_w_m2,
    )
