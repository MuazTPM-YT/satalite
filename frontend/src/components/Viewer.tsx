// 3D viewer. R3F canvas with clip plane, probe popup, synced legend
"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import TBeamMesh from "@/components/TBeamMesh";
import type { ProbeResult } from "@/components/TBeamMesh";
import ThermalLegend from "@/components/ThermalLegend";
import type { ThermalSimulationResult } from "@/lib/mockThermalField";
import { fmtLen, type LengthUnit } from "@/lib/units";

// camera preset angles. front = default opening framing
type PresetView = "top" | "front" | "iso";
const PRESET_POS: Record<PresetView, THREE.Vector3> = {
  top: new THREE.Vector3(0, 5, 0),
  front: new THREE.Vector3(0, 0, 5),
  iso: new THREE.Vector3(2.9, 2.2, 3.5),
};

// minimal orbit controls surface we drive directly
interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

// camera preset pill style, shared with Section2D toolbar
export function camClass(active: boolean): string {
  return active
    ? "px-3 py-1 text-xs rounded-sm bg-bg-elevated text-text-primary font-medium"
    : "px-3 py-1 text-xs rounded-sm text-text-secondary hover:text-text-primary transition-colors";
}

interface ViewerProps {
  sim: ThermalSimulationResult;
  timeIndex: number;
  // element length from shared LeftPanel config state
  length_m: number;
  // dimension display unit for clip-depth label
  units: LengthUnit;
}

// inside-canvas controller: snaps camera, clears highlight on manual orbit
function CameraRig({
  preset,
  onDrift,
}: {
  preset: PresetView | null;
  onDrift: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const snappingRef = useRef(false);
  const presetPosRef = useRef<THREE.Vector3 | null>(null);

  // snap camera + target whenever a preset is chosen
  const applyPreset = useCallback(
    (view: PresetView) => {
      snappingRef.current = true;
      const pos = PRESET_POS[view];
      camera.position.copy(pos);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
      presetPosRef.current = pos.clone();
      snappingRef.current = false;
    },
    [camera, controls]
  );

  // run snap after render when preset id changes (re-click after drift retriggers)
  useEffect(() => {
    if (preset !== null) applyPreset(preset);
  }, [preset, applyPreset]);

  // user orbited/panned away from the preset position — drop the highlight
  const handleOrbitChange = useCallback(() => {
    if (snappingRef.current || !presetPosRef.current) return;
    if (camera.position.distanceTo(presetPosRef.current) > 0.05) {
      onDrift();
    }
  }, [camera, onDrift]);

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={0.5}
      maxDistance={20}
      onChange={handleOrbitChange}
    />
  );
}

export default function Viewer({ sim, timeIndex, length_m, units }: ViewerProps) {
  // clip plane position along Z axis (0 = fully open, 1 = fully closed)
  const [clipFrac, setClipFrac] = useState(1.0);
  // active camera preset, null once user orbits away
  const [camView, setCamView] = useState<PresetView | null>("front");

  // probe state
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probePos, setProbePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // transient hover tooltip state — temp only, no maturity/strength
  const [hover, setHover] = useState<{ temp_c: number; x: number; y: number } | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // compute clip plane and slice Z coordinate from fraction
  const { clippingPlane, clipZ } = useMemo(() => {
    if (clipFrac >= 0.999) return { clippingPlane: null, clipZ: null };
    const halfLen = length_m / 2;
    const z = -halfLen + clipFrac * length_m;
    return {
      clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, -1), z),
      clipZ: z,
    };
  }, [clipFrac, length_m]);



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

  // hover feed from mesh — temp only, mesh already throttles to ~25/s
  const handleHover = useCallback(
    (temp_c: number, event: { offsetX: number; offsetY: number }) => {
      setHover({ temp_c, x: event.offsetX, y: event.offsetY });
    },
    []
  );

  const handleHoverEnd = useCallback(() => setHover(null), []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* toolbar row */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-0.5 bg-bg-primary rounded-md p-0.5">
          <button
            aria-pressed={camView === "top"}
            className={camClass(camView === "top")}
            onClick={() => setCamView("top")}
          >
            ☐ Top
          </button>
          <button
            aria-pressed={camView === "front"}
            className={camClass(camView === "front")}
            onClick={() => setCamView("front")}
          >
            ◧ Front
          </button>
          <button
            aria-pressed={camView === "iso"}
            className={camClass(camView === "iso")}
            onClick={() => setCamView("iso")}
          >
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
            length_m={length_m}
            clippingPlane={clippingPlane}
            clipZ={clipZ}
            onProbe={handleProbe}
            onHover={handleHover}
            onHoverEnd={handleHoverEnd}
          />
          <CameraRig preset={camView} onDrift={() => setCamView(null)} />
        </Canvas>

        {/* clip plane slider — right edge, vertical. stops above hint block so
            depth label never collides with interaction hints */}
        <div className="absolute top-12 right-16 bottom-24 flex flex-col items-center gap-1">
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
            {fmtLen(clipFrac * length_m, units)} {units}
          </span>
        </div>

        {/* transient hover tooltip — single-line chip, visually distinct from
            the bordered probe card; never blocks the cursor */}
        {hover && (
          <div
            className="absolute z-10 pointer-events-none px-2 py-0.5 rounded-sm bg-black/85 border border-accent-blue text-[10px] font-medium text-text-primary tabular-nums"
            style={{ left: `${hover.x + 14}px`, top: `${hover.y - 22}px` }}
          >
            {hover.temp_c.toFixed(1)} °C
          </div>
        )}

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

        {/* right-side color legend — shared component, same as 2D view */}
        <div className="absolute top-4 right-4 pointer-events-none">
          <ThermalLegend defLimit_c={sim.flags.def_risk.limit} />
        </div>
      </div>
    </div>
  );
}
