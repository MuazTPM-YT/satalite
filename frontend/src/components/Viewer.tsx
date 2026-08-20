// 3D viewer. R3F canvas with extruded T-beam heatmap
"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import TBeamMesh from "@/components/TBeamMesh";
import { generateMockThermalSimulation } from "@/lib/mockThermalField";

// default at t=0 matching TimeScrubber initial state
const DEFAULT_TIME_INDEX = 0;

export default function Viewer() {
  // generate sim data once on mount
  const sim = useMemo(() => generateMockThermalSimulation(), []);

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

      {/* 3D canvas */}
      <div className="flex-1 relative bg-bg-primary">
        <Canvas
          camera={{
            position: [0, 0, 5],
            fov: 40,
            near: 0.01,
            far: 100,
          }}
          gl={{ antialias: true }}
          style={{ background: "#0d1117" }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} />
          <directionalLight position={[-3, -2, -4]} intensity={0.3} />
          <TBeamMesh sim={sim} timeIndex={DEFAULT_TIME_INDEX} />
          <OrbitControls
            enableDamping
            dampingFactor={0.12}
            minDistance={0.5}
            maxDistance={20}
          />
        </Canvas>

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

        {/* right-side color legend */}
        <div className="absolute top-4 right-4 flex flex-col items-center gap-0.5 pointer-events-none">
          <span className="text-[10px] text-text-muted mb-1">°C</span>
          <div className="w-3 h-32 rounded-sm" style={{
            background: "linear-gradient(to bottom, #d92718, #f28d0f, #73d926, #268ad9, #1c3fa6)"
          }} />
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
