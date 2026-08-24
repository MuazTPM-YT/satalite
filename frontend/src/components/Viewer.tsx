// 3D viewer. The 2D solution extruded, with a section cut that measures what it removed.
"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import SectionMesh from "@/components/SectionMesh";
import type { ProbeResult } from "@/components/SectionMesh";
import ThermalLegend from "@/components/ThermalLegend";
import ProbeCard from "@/components/ProbeCard";
import { cutMetrics, maskArea_m2, probeGeometry, type ProbeGeometry } from "@/lib/sectionMetrics";
import {
  Box,
  ChevronDown,
  X,
  Crosshair,
  Move3d,
  RotateCcw,
  Scan,
  SquareDashedBottom,
} from "lucide-react";
import { Toolbar, ToolbarButton, ToolbarDivider, Readout, SectionLabel, cx } from "@/components/ui";
import { ScrubField } from "@/components/fields";
import type { SimulationResult } from "@/lib/api";
import { fmtLen, type LengthUnit } from "@/lib/units";

// camera preset directions, unit length. The distance comes from the element, because
// a fixed one either buries the camera inside a 6 m beam or strands it from a column.
type PresetView = "top" | "front" | "left" | "iso";
const PRESET_DIR: Record<PresetView, THREE.Vector3> = {
  top: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(-1, 0, 0),
  iso: new THREE.Vector3(0.62, 0.47, 0.75).normalize(),
};

// how far back the whole element fits in a 40 degree fov, with a little air.
function frameDistance(radius_m: number): number {
  return Math.max(radius_m / Math.tan((40 * Math.PI) / 360), 0.5) * 1.25;
}

// minimal orbit controls surface we drive directly
interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

interface ViewerProps {
  sim: SimulationResult;
  // index into sim.fields.times_h, NOT into sim.times_h
  frameIndex: number;
  // fixed colour-scale bounds, shared with the 2D view so the two agree
  scale_min_c?: number;
  scale_max_c?: number;
  // element length from shared config state
  length_m: number;
  units: LengthUnit;
}

/**
 * Where the probe read, drawn in the scene.
 *
 * `depthTest={false}` on purpose: the sample is usually INSIDE the concrete, and a
 * marker the body hides is a marker that does not exist. It reads as a point seen
 * through the element, which is exactly what it is.
 */
function ProbeMarker({ at, radius_m }: { at: [number, number, number]; radius_m: number }) {
  return (
    <mesh position={at} renderOrder={20}>
      <sphereGeometry args={[Math.max(radius_m * 0.02, 0.008), 24, 16]} />
      {/* transparent, so it sorts into the pass the translucent body draws in and
          lands ON TOP of it rather than under. */}
      <meshBasicMaterial color="#7599fa" depthTest={false} depthWrite={false} transparent toneMapped={false} />
    </mesh>
  );
}

/**
 * Which edges the distances are measured to.
 *
 * The readout names them A, B, C; this draws those same letters on the element, on
 * the edges themselves. Each one is a real edge of the extrusion - the section vertex
 * swept along the length - so "42 mm to edge B" points at a line the reader can see
 * rather than at an index only the code knows.
 */
function EdgeCallouts({
  geometry,
  offset_m,
  probeAt,
  zNear,
  zFar,
}: {
  geometry: ProbeGeometry;
  offset_m: [number, number];
  probeAt: [number, number, number];
  zNear: number;
  zFar: number;
}) {
  const shown = geometry.edges.slice(0, 2);

  const lines = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const e of geometry.edges.slice(0, 2)) {
      const x = e.at[0] - offset_m[0];
      const y = e.at[1] - offset_m[1];
      // the edge itself, swept the whole visible length
      pts.push(new THREE.Vector3(x, y, zNear), new THREE.Vector3(x, y, zFar));
      // and the measured distance, probe to that edge, in the probe's own plane
      pts.push(new THREE.Vector3(...probeAt), new THREE.Vector3(x, y, probeAt[2]));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [geometry, offset_m, probeAt, zNear, zFar]);

  useEffect(() => () => lines.dispose(), [lines]);

  return (
    <group>
      <lineSegments geometry={lines} renderOrder={19}>
        <lineBasicMaterial color="#7599fa" depthTest={false} depthWrite={false} toneMapped={false} transparent opacity={0.95} />
      </lineSegments>
      {shown.map((e) => (
        <Html
          key={e.index}
          position={[e.at[0] - offset_m[0], e.at[1] - offset_m[1], (zNear + zFar) / 2]}
          center
          zIndexRange={[15, 10]}
          style={{ pointerEvents: "none" }}
        >
          <span className="rounded-md bg-bg-surface/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-blue ring-1 ring-inset ring-accent-blue/40">
            {e.tag}
          </span>
        </Html>
      ))}
    </group>
  );
}

// inside-canvas controller: snaps camera, clears highlight on manual orbit
function CameraRig({
  preset,
  radius_m,
  onDrift,
}: {
  preset: PresetView | null;
  radius_m: number;
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
      const pos = PRESET_DIR[view].clone().multiplyScalar(frameDistance(radius_m));
      camera.position.copy(pos);
      // A camera looking straight down needs an up vector that is not also straight
      // down, or the view rolls to an arbitrary angle. Every other preset keeps +Y up.
      camera.up.set(0, view === "top" ? 0 : 1, view === "top" ? -1 : 0);
      // Aim it here rather than leaving that to the controls. On the FIRST mount the
      // controls are not in the store yet, so the effect below moved the camera to the
      // preset position and left it pointing down -Z - which is off the element
      // entirely, and the 3D view opened empty until a preset was clicked by hand.
      camera.lookAt(0, 0, 0);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
      presetPosRef.current = pos.clone();
      snappingRef.current = false;
    },
    [camera, controls, radius_m],
  );

  useEffect(() => {
    if (preset !== null) applyPreset(preset);
  }, [preset, applyPreset]);

  // user orbited/panned away from the preset position — drop the highlight
  const handleOrbitChange = useCallback(() => {
    if (snappingRef.current || !presetPosRef.current) return;
    if (camera.position.distanceTo(presetPosRef.current) > 0.05) onDrift();
  }, [camera, onDrift]);

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={radius_m * 0.2}
      maxDistance={radius_m * 12}
      onChange={handleOrbitChange}
    />
  );
}

export default function Viewer({ sim, frameIndex, scale_min_c, scale_max_c, length_m, units }: ViewerProps) {
  // how much of the length is still shown. 100 = uncut.
  const [cutPct, setCutPct] = useState(100);
  const [opacity, setOpacity] = useState(62);
  const [camView, setCamView] = useState<PresetView | null>("iso");
  const [showDistances, setShowDistances] = useState(false);
  const [showTakeoff, setShowTakeoff] = useState(false);

  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probePos, setProbePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // transient hover tooltip — temperature only, no maturity or strength
  const [hover, setHover] = useState<{ temp_c: number; x: number; y: number } | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // Keep the drawing buffer the size of the box it sits in.
  //
  // r3f sizes the canvas from its own measurement of this container, and on the FIRST
  // mount that measurement never landed: the canvas stayed at the HTML default
  // 300x150 inside a 2120x664 box, so the 3D view opened empty and only filled in
  // when the window happened to be resized by hand. r3f re-measures on a window
  // resize, so this watches the real box and asks for one whenever the two have
  // drifted apart. It fires only from a ResizeObserver callback - never in a loop -
  // and does nothing at all once they agree.
  useEffect(() => {
    const box = canvasWrapRef.current;
    if (!box) return;
    const sync = () => {
      const canvas = box.querySelector("canvas");
      if (!canvas) return;
      const r = box.getBoundingClientRect();
      if (Math.abs(canvas.clientWidth - r.width) > 1 || Math.abs(canvas.clientHeight - r.height) > 1) {
        window.dispatchEvent(new Event("resize"));
      }
    };
    const ro = new ResizeObserver(sync);
    ro.observe(box);
    sync();
    return () => ro.disconnect();
  }, []);

  const clipFrac = cutPct / 100;

  // bounding radius of the whole extruded element, for camera framing
  const radius_m = useMemo(() => {
    const w = Math.max(...sim.outline_m.map((p) => p[0]));
    const h = Math.max(...sim.outline_m.map((p) => p[1]));
    return 0.5 * Math.hypot(w, h, length_m);
  }, [sim.outline_m, length_m]);

  const { clippingPlane, clipZ } = useMemo(() => {
    if (clipFrac >= 0.999) return { clippingPlane: null, clipZ: null };
    const halfLen = length_m / 2;
    const z = -halfLen + clipFrac * length_m;
    return { clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, -1), z), clipZ: z };
  }, [clipFrac, length_m]);

  // What the cut actually removed.
  //
  // The face area comes from the MASK when the response carries a field - that is the
  // area the solver ran on, rasterisation and all - so the volume below is the volume
  // of the thing that was solved, not of an idealised polygon beside it.
  const cut = useMemo(() => {
    const frame = sim.fields?.temp_c[Math.min(frameIndex, sim.fields.temp_c.length - 1)];
    const area = frame && sim.fields ? maskArea_m2(frame, sim.fields.dx_m) : undefined;
    return cutMetrics(sim.outline_m, length_m, clipFrac, area);
  }, [sim.outline_m, sim.fields, frameIndex, length_m, clipFrac]);

  const geometry = useMemo(
    () => (probe ? probeGeometry(sim.outline_m, probe.xy_m) : null),
    [probe, sim.outline_m],
  );

  // probe click from the mesh — position the popup near the hit, clamped to the canvas
  const handleProbe = useCallback(
    (result: ProbeResult | null, event?: { offsetX: number; offsetY: number }) => {
      if (!result) return;
      setProbe(result);
      if (event && canvasWrapRef.current) {
        const rect = canvasWrapRef.current.getBoundingClientRect();
        const popupW = 240;
        const popupH = 200;
        setProbePos({
          x: Math.max(8, Math.min(event.offsetX + 15, rect.width - popupW - 8)),
          y: Math.max(8, Math.min(event.offsetY - popupH / 2, rect.height - popupH - 8)),
        });
      }
    },
    [],
  );

  const handleHover = useCallback(
    (temp_c: number, event: { offsetX: number; offsetY: number }) => {
      setHover({ temp_c, x: event.offsetX, y: event.offsetY });
    },
    [],
  );
  const handleHoverEnd = useCallback(() => setHover(null), []);

  const cutOpen = clipFrac < 0.999;

  return (
    <div className="relative min-h-0 flex-1 bg-bg-primary" ref={canvasWrapRef}>
      <Toolbar className="absolute left-1/2 top-4 z-20 -translate-x-1/2">
        <ToolbarButton icon={SquareDashedBottom} active={camView === "top"} onClick={() => setCamView("top")} title="Look straight down">
          Top
        </ToolbarButton>
        <ToolbarButton icon={Scan} active={camView === "front"} onClick={() => setCamView("front")} title="Look along the length">
          Front
        </ToolbarButton>
        <ToolbarButton icon={Scan} active={camView === "left"} onClick={() => setCamView("left")} title="Look along the width">
          Left
        </ToolbarButton>
        <ToolbarButton icon={Box} active={camView === "iso"} onClick={() => setCamView("iso")} title="Isometric">
          Iso
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton icon={RotateCcw} onClick={() => setCamView("iso")} title="Reset the camera to isometric">
          Reset
        </ToolbarButton>
      </Toolbar>

      <Canvas
        camera={{
          position: [0, 0, frameDistance(radius_m)],
          fov: 40,
          near: 0.01,
          far: Math.max(100, radius_m * 40),
        }}
        gl={{ antialias: true, localClippingEnabled: true }}
        style={{ background: "#0a0b0c" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={0.8} />
        <directionalLight position={[-3, -2, -4]} intensity={0.3} />
        <SectionMesh
          sim={sim}
          frameIndex={frameIndex}
          scale_min_c={scale_min_c ?? 0}
          scale_max_c={scale_max_c ?? 1}
          length_m={length_m}
          opacity={opacity / 100}
          clippingPlane={clippingPlane}
          clipZ={clipZ}
          onProbe={handleProbe}
          onHover={handleHover}
          onHoverEnd={handleHoverEnd}
        />
        {/* The probe, shown where it actually is. Clicking a surface used to move a
            number in a popup and nothing in the scene, which left the reader to trust
            that the two were about the same point. */}
        {probe && <ProbeMarker at={probe.world} radius_m={radius_m} />}
        {probe && showDistances && geometry && (
          <EdgeCallouts
            geometry={geometry}
            offset_m={probe.offset_m}
            probeAt={probe.world}
            zNear={-length_m / 2}
            zFar={clipZ ?? length_m / 2}
          />
        )}
        <CameraRig preset={camView} radius_m={radius_m} onDrift={() => setCamView(null)} />
      </Canvas>

      {/* The two controls that change what is on screen without moving the camera.
          Bottom strip rather than the left rail: the left rail is where the input
          palette docks, and chrome a palette covers by default is chrome nobody finds. */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
        {/* What the cut removed. A slider that hides half an element without saying how
            much that was is a view control; with these numbers it is a take-off. */}
        {showTakeoff && (
          <Toolbar className="w-[300px] flex-col items-stretch !p-2.5">
            <SectionLabel className="mb-1.5" note={`${(100 - cutPct).toFixed(1)} % hidden`}>
              Cut take-off
            </SectionLabel>
            <Readout
              label="Cut at"
              value={fmtLen(cut.at_m, units)}
              unit={units}
              field="from the near end"
              tone={cutOpen ? "accent" : "default"}
            />
            <Readout label="Cut face area" value={cut.face_area_m2.toFixed(4)} unit="m²" field="cross-section area, from the solved mask" />
            <Readout label="Cut face perimeter" value={cut.face_perimeter_m.toFixed(3)} unit="m" field="outline_m perimeter" />
            <Readout label="Still shown" value={cut.kept_volume_m3.toFixed(3)} unit="m³" field="volume still drawn" />
            <Readout
              label="Removed"
              value={cut.removed_volume_m3.toFixed(3)}
              unit="m³"
              tone={cutOpen ? "amber" : "default"}
              field="volume the cut took away"
            />
            <Readout label="Removed mass" value={(cut.removed_mass_kg / 1000).toFixed(2)} unit="t" field="at 2400 kg/m³, the density the solve assumed" />
            <Readout label="Whole element" value={cut.total_volume_m3.toFixed(3)} unit="m³" field="face area × length" />
            <p className="mt-1.5 border-t border-hairline pt-1.5 text-[9px] leading-relaxed text-text-muted">
              Volume is the solved cross-section swept along {fmtLen(length_m, units)} {units}.
              Length is a view parameter — the solver is 2D — so this is a take-off of the
              element as drawn.
            </p>
          </Toolbar>
        )}

        <Toolbar>
          <SquareDashedBottom className="ml-1 h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
          {/* the label column shrinks to its own word here: the panel's 74px column
              exists to line a stack of rows up, and this row has no stack. */}
          <div className="px-1">
            <ScrubField
              label="Cut"
              labelWidth="w-auto"
              unit="%"
              value={cutPct}
              min={0}
              max={100}
              step={0.5}
              resetTo={100}
              onChange={setCutPct}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowTakeoff((v) => !v)}
            aria-expanded={showTakeoff}
            title="How much concrete the cut removed"
            className={cx(
              "flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium tabular-nums",
              showTakeoff ? "bg-accent-blue-dim text-accent-blue" : "text-text-secondary hover:bg-elevate-2 hover:text-text-primary",
            )}
          >
            {cut.removed_volume_m3.toFixed(2)} m³ out
            <ChevronDown className={cx("h-3 w-3 transition-transform duration-150", showTakeoff && "rotate-180")} strokeWidth={2.5} />
          </button>
          <ToolbarDivider />
          <div className="px-1">
            <ScrubField
              label="Opacity"
              labelWidth="w-auto"
              unit="%"
              value={opacity}
              min={0}
              max={100}
              step={1}
              resetTo={62}
              onChange={setOpacity}
            />
          </div>
        </Toolbar>
      </div>

      {/* transient hover chip — never blocks the cursor */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-accent-blue/50 bg-bg-surface/90 px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-text-primary backdrop-blur-sm"
          style={{ left: `${hover.x + 14}px`, top: `${hover.y - 22}px` }}
        >
          {hover.temp_c.toFixed(1)} °C
        </div>
      )}

      {/* probe popup — anchored at the clicked point */}
      {probe && (
        <div
          className="pointer-events-auto absolute z-20 w-[240px]"
          style={{ left: `${probePos.x}px`, top: `${probePos.y}px` }}
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => setProbe(null)}
              aria-label="Dismiss probe"
              className="absolute -right-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-bg-surface text-text-muted ring-1 ring-inset ring-hairline hover:bg-elevate-2 hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <ProbeCard
              sample={probe}
              geometry={geometry}
              units={units}
              showDistances={showDistances}
              onToggleDistances={() => setShowDistances((s) => !s)}
              emptyHint=""
            />
          </div>
        </div>
      )}

      {/* What the extrusion is and is not, with the interaction hints under it. */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[19rem] flex-col gap-2">
        <p className="text-[11px] leading-relaxed text-text-muted">
          The 2D solution, extruded. Every slice is identical — the solver is 2D because
          the element is prismatic, so the length carries no physics. End effects are not
          modelled.
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { icon: RotateCcw, label: "Orbit", how: "Left drag" },
            { icon: Move3d, label: "Pan", how: "Right drag" },
            { icon: Crosshair, label: "Probe", how: "Click surface" },
          ].map((h) => (
            <div
              key={h.label}
              className={cx(
                "flex items-center gap-2 rounded-lg border border-hairline",
                "bg-bg-surface/80 px-2.5 py-1.5 backdrop-blur-xl",
              )}
            >
              <h.icon className="h-3.5 w-3.5 shrink-0 text-accent-blue" strokeWidth={2} />
              <span className="text-[11px] font-medium text-text-primary">{h.label}</span>
              <span className="font-mono text-[10px] text-text-muted">{h.how}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute right-4 top-1/2 z-10 -translate-y-1/2">
        <ThermalLegend min_c={scale_min_c} max_c={scale_max_c} defLimit_c={sim.breaches.def_threshold_c} />
      </div>
    </div>
  );
}
