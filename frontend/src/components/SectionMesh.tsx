// the solved cross-section, extruded along the element's length.
//
// The extrusion is for legibility, not physics: the solver is 2D because the elements
// are prismatic, so EVERY slice is identical. One texture, UVs taken from (x, y) alone,
// nothing keyed on z. A gradient along the length would be a bug, not a feature.
"use client";

import { useMemo, useRef, useCallback } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { SimulationResult } from "@/lib/api";
import { sampleField, type Sample } from "@/lib/probe";
import { buildHeatmapTexture } from "@/lib/heatmapTexture";
import { buildSectionGeometry } from "@/lib/extrude";

/** A probe hit: the sampled cell, plus where it landed in the scene. */
export interface ProbeResult extends Sample {
  /** the clicked point in world space, so the viewer can mark it */
  world: [number, number, number];
  /** how far the geometry was moved off the section origin, for the reverse trip */
  offset_m: [number, number];
}

interface SectionMeshProps {
  sim: SimulationResult;
  frameIndex: number;
  scale_min_c: number;
  scale_max_c: number;
  length_m: number;
  /** how solid the extrusion draws, 0-1. Below 1 the far side reads through. */
  opacity?: number;
  clippingPlane?: THREE.Plane | null;
  clipZ?: number | null;
  onProbe?: (result: ProbeResult | null, event?: { offsetX: number; offsetY: number }) => void;
  onHover?: (temp_c: number, event: { offsetX: number; offsetY: number }) => void;
  onHoverEnd?: () => void;
}

export default function SectionMesh({
  sim,
  frameIndex,
  scale_min_c,
  scale_max_c,
  length_m,
  opacity = 0.62,
  clippingPlane = null,
  clipZ = null,
  onProbe,
  onHover,
  onHoverEnd,
}: SectionMeshProps) {
  const fields = sim.fields;
  const frame = fields?.temp_c[Math.min(frameIndex, fields.temp_c.length - 1)] ?? null;

  // outline_m IS the polygon the solver rasterised, so the mesh and the mask cannot
  // drift apart. The extrusion itself lives in lib/extrude.ts - one place, so the
  // "no variation along z" invariant has exactly one line that could break it.
  const { geometry, capGeometry, offset } = useMemo(() => {
    const pts = sim.outline_m;
    // the grid extent, not the outline bbox: the texture spans the whole raster.
    const w = fields ? fields.nx * fields.dx_m : Math.max(...pts.map((p) => p[0]));
    const h = fields ? fields.ny * fields.dx_m : Math.max(...pts.map((p) => p[1]));
    return buildSectionGeometry(pts, length_m, w, h);
  }, [sim.outline_m, fields, length_m]);

  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry, 20), [geometry]);

  const texture = useMemo(
    () => (frame ? buildHeatmapTexture(frame, scale_min_c, scale_max_c) : null),
    [frame, scale_min_c, scale_max_c],
  );

  const clippingPlanes = useMemo(() => (clippingPlane ? [clippingPlane] : []), [clippingPlane]);

  // world hit point -> section coordinates -> the same bilinear sample 2D uses
  const sampleAt = useCallback(
    (pt: THREE.Vector3): ProbeResult | null => {
      if (!fields || !frame) return null;
      const s: Sample | null = sampleField(frame, fields.dx_m, pt.x + offset.x, pt.y + offset.y);
      if (!s) return null;
      return {
        ...s,
        // the marker goes where the SAMPLE was read, not where the ray hit: those
        // differ by up to half a cell, and a dot beside the number it belongs to is
        // a dot pointing at the wrong cell.
        world: [s.xy_m[0] - offset.x, s.xy_m[1] - offset.y, pt.z],
        offset_m: [offset.x, offset.y],
      };
    },
    [fields, frame, offset],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!onProbe) return;
      e.stopPropagation();
      const nativeEvt = e.nativeEvent as MouseEvent;
      onProbe(sampleAt(e.point.clone()), {
        offsetX: nativeEvt.offsetX,
        offsetY: nativeEvt.offsetY,
      });
    },
    [onProbe, sampleAt],
  );

  const lastHoverRef = useRef(0);
  const handleHoverMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!onHover) return;
      const now = performance.now();
      if (now - lastHoverRef.current < 40) return;
      lastHoverRef.current = now;
      const s = sampleAt(e.point);
      if (!s) return;
      const nativeEvt = e.nativeEvent as PointerEvent;
      onHover(s.temp_c, { offsetX: nativeEvt.offsetX, offsetY: nativeEvt.offsetY });
    },
    [onHover, sampleAt],
  );

  return (
    <group>
      <mesh geometry={geometry} onClick={handleClick} onPointerMove={handleHoverMove} onPointerOut={onHoverEnd}>
        <meshStandardMaterial
          map={texture}
          color={texture ? undefined : "#2a2c31"}
          side={THREE.DoubleSide}
          transparent
          opacity={opacity}
          // a fully opaque mesh should still write depth, or its own back faces sort
          // through the front ones and the section reads inside-out.
          depthWrite={opacity >= 0.99}
          roughness={0.35}
          metalness={0.05}
          clippingPlanes={clippingPlanes}
          clipShadows
        />
      </mesh>

      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial
          color="#c9ccd1"
          transparent
          // the wireframe survives a transparent body: at zero fill the edges are the
          // only thing left saying where the element is.
          opacity={Math.max(0.35, 0.55 * Math.max(opacity, 0.4))}
          clippingPlanes={clippingPlanes}
        />
      </lineSegments>

      {clipZ !== null && clipZ !== undefined && (
        <mesh geometry={capGeometry} position={[0, 0, clipZ]} onClick={handleClick} onPointerMove={handleHoverMove} onPointerOut={onHoverEnd}>
          <meshStandardMaterial
            map={texture}
            color={texture ? undefined : "#2a2c31"}
            side={THREE.DoubleSide}
            transparent
            // The cut face stays near-solid whatever the body does: it is the exposed
            // section, the one surface the cut exists to show.
            opacity={Math.max(0.8, opacity)}
            depthWrite
            roughness={0.6}
            metalness={0.05}
          />
        </mesh>
      )}
    </group>
  );
}
