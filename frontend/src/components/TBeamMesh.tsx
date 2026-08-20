// extruded T-beam mesh with heatmap texture from simulation data
"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { ThermalSimulationResult } from "@/lib/mockThermalField";
import { buildHeatmapTexture } from "@/lib/thermalColormap";

// temp range for colormap (matches checks panel DEF limit = 70)
const TEMP_MIN_C = 20;
const TEMP_MAX_C = 75;

// element length from LeftPanel hardcoded value
const ELEMENT_LENGTH_M = 6.0;

interface TBeamMeshProps {
  sim: ThermalSimulationResult;
  timeIndex?: number;
}

export default function TBeamMesh({ sim, timeIndex = 0 }: TBeamMeshProps) {
  const { grid, fields } = sim;

  // build Shape from outline, extrude along Z
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const pts = grid.outline;
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i][0], pts[i][1]);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: ELEMENT_LENGTH_M,
      bevelEnabled: false,
    });

    // compute UVs from vertex position in cross-section plane
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const w = grid.nx * grid.dx_m;
    const h = grid.ny * grid.dx_m;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uv.setXY(i, x / w, y / h);
    }
    uv.needsUpdate = true;

    // centre geometry at origin for nicer orbit
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const cx = (bb.max.x + bb.min.x) / 2;
    const cy = (bb.max.y + bb.min.y) / 2;
    const cz = (bb.max.z + bb.min.z) / 2;
    geo.translate(-cx, -cy, -cz);

    return geo;
  }, [grid]);

  // rebuild heatmap texture when time index changes
  const texture = useMemo(() => {
    const ti = Math.max(0, Math.min(timeIndex, fields.temperature_c.length - 1));
    return buildHeatmapTexture(
      fields.temperature_c[ti],
      grid.mask,
      TEMP_MIN_C,
      TEMP_MAX_C
    );
  }, [fields, grid, timeIndex]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        map={texture}
        side={THREE.DoubleSide}
        roughness={0.6}
        metalness={0.05}
      />
    </mesh>
  );
}
