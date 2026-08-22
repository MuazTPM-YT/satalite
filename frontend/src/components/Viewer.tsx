// 3D viewer. R3F canvas with clip plane, probe popup, synced legend
"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import TBeamMesh from "@/components/TBeamMesh";
import type { ProbeResult } from "@/components/TBeamMesh";
import type { ThermalSimulationResult } from "@/lib/mockThermalField";
import { buildLegendGradient } from "@/lib/thermalColormap";

// element length matching LeftPanel
const ELEMENT_LENGTH_M = 6.0;

interface ViewerProps {
  sim: ThermalSimulationResult;
  timeIndex: number;
}

export default function Viewer({ sim, timeIndex }: ViewerProps) {
  // clip plane position along Z axis (0 = fully open, 1 = fully closed)
  const [clipFrac, setClipFrac] = useState(1.0);

  // probe state
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probePos, setProbePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // compute clip plane and slice Z coordinate from fraction
  const { clippingPlane, clipZ } = useMemo(() => {
    if (clipFrac >= 0.999) return { clippingPlane: null, clipZ: null };
    const halfLen = ELEMENT_LENGTH_M / 2;
    const z = -halfLen + clipFrac * ELEMENT_LENGTH_M;
    return {
      clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, -1), z),
      clipZ: z,
    };
  }, [clipFrac]);

  // depth label in mm for clip slider
  const clipDepth_mm = Math.round(clipFrac * ELEMENT_LENGTH_M * 1000);

  // legend gradient from same colormap function
  const legendGradient = useMemo(() => buildLegendGradient(), []);

  // handle probe click from mesh — position near click point with boundary clamping
  const handleProbe = useCallback(
    (result: ProbeResult | null, event?: { offsetX: number; offsetY: number }) => {
      if (!result) return;
      setProbe(result);
      if (event && canvasWrapRef.current) {
        const rect = canvasWrapRef.current.getBoundingClientRect();
        const popupW = 180;
        const popupH = 140;
        const x = Math.max(8, Math.min(event.offsetX + 15, rect.width - popupW - 8));
        const y = Math.max(8, Math.min(event.offsetY - popupH / 2, rect.height - popupH - 8));
        setProbePos({ x, y });
      }
    },
    []
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* toolbar row */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-0.5 bg-bg-primary rounded-md p-0.5">
          <button className="px-3 py-1 text-xs rounded text-text-secondary hover:text-text-primary transition-colors">
            ☐ Top
          </button>
          <button className="px-3 py-1 text-xs rounded bg-bg-elevated text-text-primary font-medium">
            ◧ Front
          </button>
          <button className="px-3 py-1 text-xs rounded text-text-secondary hover:text-text-primary transition-colors">
            ◇ Iso
          </button>
        </div>

        <div className="w-px h-4 bg-border-default mx-1" />

        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Grid">
          ⊞
        </button>
        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Eye">
          ◉
        </button>
        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Section">
          ◫
        </button>

        <div className="ml-2 px-3 py-1 text-xs rounded-md bg-bg-primary border border-border-default text-text-primary">
          Temperature
        </div>

        <div className="flex-1" />

        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Shrink">
          ◁ ▷
        </button>
        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Expand">
          ⤢
        </button>
      </div>

      {/* 3D canvas + overlays */}
      <div className="flex-1 relative bg-bg-primary" ref={canvasWrapRef}>
        <Canvas
          camera={{
            position: [0, 0, 5],
            fov: 40,
            near: 0.01,
            far: 100,
          }}
          gl={{ antialias: true, localClippingEnabled: true }}
          style={{ background: "#0d1117" }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} />
          <directionalLight position={[-3, -2, -4]} intensity={0.3} />
          <TBeamMesh
            sim={sim}
            timeIndex={timeIndex}
            clippingPlane={clippingPlane}
            clipZ={clipZ}
            onProbe={handleProbe}
          />
          <OrbitControls
            enableDamping
            dampingFactor={0.12}
            minDistance={0.5}
            maxDistance={20}
          />
        </Canvas>

        {/* clip plane slider — right edge, vertical */}
        <div className="absolute top-12 right-16 bottom-8 flex flex-col items-center gap-1">
          <span className="text-[9px] text-text-muted">SECTION CUT</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={clipFrac}
            onChange={(e) => setClipFrac(Number(e.target.value))}
            className="h-full"
            style={{
              writingMode: "vertical-lr",
              direction: "rtl",
              width: "16px",
            }}
          />
          <span className="text-[9px] text-text-muted tabular-nums">
            {clipDepth_mm} mm
          </span>
        </div>

        {/* probe popup */}
        {probe && (
          <div
            className="absolute z-10 pointer-events-auto"
            style={{
              left: `${probePos.x}px`,
              top: `${probePos.y}px`,
            }}
          >
            <div className="bg-bg-elevated border border-border-default rounded-lg p-3 shadow-lg min-w-[160px] relative">
              <button
                onClick={() => setProbe(null)}
                className="absolute top-1.5 right-2 text-text-muted hover:text-text-primary text-xs"
              >
                ✕
              </button>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
                Probe
              </div>
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">Temperature</span>
                  <span className="text-text-primary font-medium">
                    {probe.temp_c.toFixed(1)} °C
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Maturity</span>
                  <span className="text-text-primary font-medium">
                    {probe.maturity_ch.toFixed(1)} °C·h
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Strength</span>
                  <span className="text-text-primary font-medium">
                    {(probe.strength_frac * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="mt-2 text-[9px] text-text-muted">
                Cell [{probe.grid_i}, {probe.grid_j}]
              </div>
            </div>
          </div>
        )}

        {/* bottom-left annotation */}
        <div className="absolute bottom-12 left-4 text-[11px] text-text-muted pointer-events-none">
          2D cross-section solution, extruded. End effects not modelled.
        </div>

        {/* bottom-right interaction hints */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 items-end pointer-events-none">
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span className="text-text-muted">⊕</span>
            <span>Orbit</span>
            <span className="text-text-muted">Left Click + Drag</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span className="text-text-muted">+</span>
            <span>Pan</span>
            <span className="text-text-muted">Right Click + Drag</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span className="text-text-muted">⊡</span>
            <span>Probe</span>
            <span className="text-text-muted">Click Surface</span>
          </div>
        </div>

        {/* right-side color legend — built from same colormap stops */}
        <div className="absolute top-4 right-4 flex flex-col items-center gap-0.5 pointer-events-none">
          <span className="text-[10px] text-text-muted mb-1">°C</span>
          <div
            className="w-3 h-32 rounded-sm"
            style={{ background: legendGradient }}
          />
          <div className="flex flex-col items-end text-[9px] text-text-muted mt-1">
            <span>75</span>
            <span className="mt-5">50</span>
            <span className="mt-5">25</span>
          </div>
        </div>
      </div>
    </div>
  );
}
