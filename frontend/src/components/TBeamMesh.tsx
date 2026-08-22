// extruded T-beam mesh with heatmap, side-wall gradient, clip plane, cut cap, click-to-probe
"use client";

import { useMemo, useRef, useCallback } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { ThermalSimulationResult } from "@/lib/mockThermalField";
import { buildHeatmapTexture } from "@/lib/thermalColormap";

// temp range for colormap (matches checks panel DEF limit = 70)
const TEMP_MIN_C = 20;
const TEMP_MAX_C = 75;

// element length from LeftPanel hardcoded value
const ELEMENT_LENGTH_M = 6.0;

export interface ProbeResult {
  position: THREE.Vector3;
  temp_c: number;
  maturity_ch: number;
  strength_frac: number;
  grid_i: number;
  grid_j: number;
}

interface TBeamMeshProps {
  sim: ThermalSimulationResult;
  timeIndex?: number;
  clippingPlane?: THREE.Plane | null;
  clipZ?: number | null;
  onProbe?: (result: ProbeResult | null, event?: { offsetX: number; offsetY: number }) => void;
}

export default function TBeamMesh({
  sim,
  timeIndex = 0,
  clippingPlane = null,
  clipZ = null,
  onProbe,
}: TBeamMeshProps) {
  const { grid, fields } = sim;
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  // build Shape from outline, create ExtrudeGeometry and cut cap ShapeGeometry
  const { geometry, capGeometry, offset } = useMemo(() => {
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

    const capGeo = new THREE.ShapeGeometry(shape);

    const w = grid.nx * grid.dx_m;
    const h = grid.ny * grid.dx_m;

    // UVs for all vertices (caps and side walls):
    // each vertex (x, y, z) maps to (u, v) = (x / w, y / h) to sample the exact
    // physical temperature field at its (x, y) boundary or interior location
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uv.setXY(i, x / w, y / h);
    }
    uv.needsUpdate = true;

    // compute UVs for cut cap geometry
    const capPos = capGeo.attributes.position;
    const capUv = capGeo.attributes.uv;
    for (let i = 0; i < capPos.count; i++) {
      const x = capPos.getX(i);
      const y = capPos.getY(i);
      capUv.setXY(i, x / w, y / h);
    }
    capUv.needsUpdate = true;

    // centre geometry at origin for nicer orbit
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const cx = (bb.max.x + bb.min.x) / 2;
    const cy = (bb.max.y + bb.min.y) / 2;
    const cz = (bb.max.z + bb.min.z) / 2;
    geo.translate(-cx, -cy, -cz);
    capGeo.translate(-cx, -cy, 0);

    return {
      geometry: geo,
      capGeometry: capGeo,
      offset: new THREE.Vector3(cx, cy, cz),
    };
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

  // clipping planes array for material
  const clippingPlanes = useMemo(
    () => (clippingPlane ? [clippingPlane] : []),
    [clippingPlane]
  );

  // click handler: convert intersection to grid coords, look up values
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!onProbe) return;
      e.stopPropagation();

      const pt = e.point.clone();
      // undo the centering offset to get back to geometry-space
      const local_x = pt.x + offset.x;
      const local_y = pt.y + offset.y;

      // convert metres to grid indices
      const i = Math.floor(local_x / grid.dx_m);
      const j = Math.floor(local_y / grid.dx_m);

      // bounds check
      if (i < 0 || i >= grid.nx || j < 0 || j >= grid.ny) {
        onProbe(null);
        return;
      }

      // skip air cells
      if (grid.mask[j][i] === 0) {
        onProbe(null);
        return;
      }

      const ti = Math.max(
        0,
        Math.min(timeIndex, fields.temperature_c.length - 1)
      );

      const nativeEvt = e.nativeEvent as MouseEvent;
      onProbe(
        {
          position: pt,
          temp_c: fields.temperature_c[ti][j][i],
          maturity_ch: fields.maturity_ch[ti][j][i],
          strength_frac: fields.strength_frac[ti][j][i],
          grid_i: i,
          grid_j: j,
        },
        { offsetX: nativeEvt.offsetX, offsetY: nativeEvt.offsetY }
      );
    },
    [onProbe, offset, grid, fields, timeIndex]
  );

  return (
    <group>
      {/* main extruded beam */}
      <mesh geometry={geometry} onClick={handleClick}>
        <meshStandardMaterial
          ref={matRef}
          map={texture}
          side={THREE.DoubleSide}
          roughness={0.6}
          metalness={0.05}
          clippingPlanes={clippingPlanes}
          clipShadows
        />
      </mesh>

      {/* cut plane cap: renders solid cross-section heatmap at the slice location */}
      {clipZ !== null && clipZ !== undefined && (
        <mesh
          geometry={capGeometry}
          position={[0, 0, clipZ]}
          onClick={handleClick}
        >
          <meshStandardMaterial
            map={texture}
            side={THREE.DoubleSide}
            roughness={0.6}
            metalness={0.05}
          />
        </mesh>
      )}
    </group>
  );
}
