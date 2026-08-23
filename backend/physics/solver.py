"""Orchestrates the timestep loop. The only stateful thing in physics/."""

import numpy as np

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
    # 1.0 where the face actually gets flux, 0.0 where it is sealed. adiabatic zeroes
    # n_exposed, so the film and the external flux vanish with it and the reconstructed
    # surface collapses back onto the cell centre - which is the truth on a sealed face.
    open_s = (n_exposed_s > 0.0).astype(np.float64)

    # free-surface cells are a subset of boundary cells. this maps one index into the other.
    order = np.zeros(mask.shape, dtype=np.int64)
    order[boundary_rows, boundary_cols] = np.arange(boundary_rows.size)
    exposed_in_boundary = order[surf_rows, surf_cols]

    # core = a fixed physical point, sampled bilinearly; surface = the mean over
    # open-faced cells. The probe is a location, not a cell, so the reported number stops
    # moving when dx does. Default is the section centroid.
    probe_rows, probe_cols, probe_w = section.probe_stencil(
        *(element.probe_xy_m if element.probe_xy_m is not None else section.centroid_m)
    )
    probe_xy_m = section.stencil_xy_m(probe_rows, probe_cols, probe_w)

    # 0 outside the mask, not nan: the hydration and maturity terms are evaluated over
    # the whole array and nan would poison the in-place source assembly. Frames are
    # nan-filled at record time, which is what the API and the tests actually see.
    temp_c = np.where(mask, element.placement_temp_c, 0.0).astype(np.float64)
    t_e_h = np.zeros(mask.shape, dtype=np.float64)
    h_sum = np.zeros(mask.shape, dtype=np.float64)
    q_sum = np.zeros(mask.shape, dtype=np.float64)
    heat_scale = mix.h_u_j_per_kg * mix.cement_kg_m3 / 3600.0
    q_face_w_m2 = np.zeros(surf_rows.size, dtype=np.float64)

    # films and the reconstructed free-surface temperature at one weather index. Pulled
    # out because the sample taken after the loop used to be a raw cell centre while every
    # sample inside it was a face temperature - one series carrying two definitions.
    def surface_state(
        now_c: FloatArray, i: int, q_face: FloatArray
    ) -> tuple[FloatArray, FloatArray, FloatArray]:
        h_rad = boundary.h_radiative(
            now_c[boundary_rows, boundary_cols], float(weather["sky_temp_c"][i])
        )
        film = boundary.h_effective(float(weather["h_conv"][i]), h_rad, 0.0) * h_multiplier
        face_c = conduction.face_temp_c(
            now_c[surf_rows, surf_cols],
            float(weather["air_temp_c"][i]),
            film[exposed_in_boundary] * open_s,
            q_face,
            dx_m,
            mix.k_w_m_k,
        )
        return h_rad, film, face_c

    record_every = max(int(round(record_every_s / dt_s)), 1)
    frames_c: list[FloatArray] = []
    frames_te: list[FloatArray] = []
    frame_times_h: list[float] = []
    core_c: list[float] = []
    max_any_c: list[float] = []
    surface_c: list[float] = []
    dt_h = dt_s / 3600.0

    for i in range(n_steps):
        air_temp_c = float(weather["air_temp_c"][i])

        # surface films, evaluated only on cells that actually have an exterior face.
        # h_rad uses the cell centre: it is cubic in kelvin, so a dx/2 offset moves it
        # by well under a percent. Uno evaporation below is the one that cannot take it.
        # surf_temp_c is the true free surface, reconstructed from the cell centre; q lags
        # one step, which at dt = 10 s against a slowly varying latent flux is immaterial.
        h_rad_b, film_open, surf_temp_c = surface_state(temp_c, i, q_face_w_m2)
        h_conv = float(weather["h_conv"][i])
        h_sum[boundary_rows, boundary_cols] = n_exposed_b * conduction.face_h_discrete(
            film_open, dx_m, mix.k_w_m_k
        ) + n_formed_b * conduction.face_h_discrete(
            boundary.h_effective(h_conv, h_rad_b, formwork_r) * h_multiplier,
            dx_m,
            mix.k_w_m_k,
        )

        # solar in, evaporative latent heat out. free surface only.
        q_face_w_m2 = np.full(surf_rows.size, float(weather["q_solar_w_m2"][i]))
        if evaporative_cooling:
            q_face_w_m2 = q_face_w_m2 - LATENT_HEAT_VAP * boundary.evaporation_rate_kg_m2_s(
                surf_temp_c, air_temp_c, float(weather["rh_frac"][i]), float(weather["wind_ms"][i])
            )
        q_face_w_m2 = q_face_w_m2 * open_s
        # q_face_w_m2 stays RAW: face_temp_c reconstructs the surface from the flux that
        # actually lands on it. Only the share that survives the half cell reaches the
        # centre, so the attenuation belongs here, on q_sum, and nowhere else.
        q_sum[surf_rows, surf_cols] = n_exposed_s * conduction.face_q_discrete(
            q_face_w_m2, film_open[exposed_in_boundary] * open_s, dx_m, mix.k_w_m_k
        )

        if i % record_every == 0:
            frames_c.append(np.where(mask, temp_c, np.nan))
            frames_te.append(np.where(mask, t_e_h, np.nan))
            frame_times_h.append(float(step_times_h[i]))
            core_c.append(float(np.dot(temp_c[probe_rows, probe_cols], probe_w)))
            max_any_c.append(float(temp_c[mask].max()))
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
    core_c.append(float(np.dot(temp_c[probe_rows, probe_cols], probe_w)))
    max_any_c.append(float(temp_c[mask].max()))
    # weather runs to n_steps - 1, so the last available index is the closest the series
    # gets to the final state. One frame of lag on the film, against the alternative of
    # this sample meaning something different from all the others.
    surface_c.append(float(surface_state(temp_c, n_steps - 1, q_face_w_m2)[2].mean()))

    core_arr = np.asarray(core_c, dtype=np.float64)
    max_any_arr = np.asarray(max_any_c, dtype=np.float64)
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
        max_anywhere_surface_diff_c=float(np.max(max_any_arr - surface_arr)),
        max_core_temp_anywhere_c=float(np.max(max_any_arr)),
        probe_xy_m=probe_xy_m,
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
