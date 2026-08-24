// 3D viewer. The 2D solution extruded, with a section cut that measures what it removed.
"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import SectionMesh from "@/components/SectionMesh";
import type { ProbeResult } from "@/components/SectionMesh";
import ThermalLegend from "@/components/ThermalLegend";
import {
  cutMetrics,
  maskArea_m2,
  sectionFeatures,
  type ProbeGeometry,
} from "@/lib/sectionMetrics";
import { frameRange, sampleField, type ProbePick } from "@/lib/probe";
import {
  Box,
  ChevronDown,
  RotateCcw,
  Scan,
  SquareDashedBottom,
  Tags,
  Target,
  View,
} from "lucide-react";
import { Toolbar, ToolbarButton, ToolbarDivider, Readout, SectionLabel, cx } from "@/components/ui";
import { useTooltip } from "@/components/Tooltip";
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

// Above this many vertices the annotation names only the features the readout is
// citing, exactly as the 2D sheet does.
const MAX_NAMED_VERTICES = 12;

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
  /** the reading on screen, owned by the studio so the Probe palette shares it */
  pick: ProbePick | null;
  onPick: (pick: ProbePick | null) => void;
  /** distances from that reading, computed once by the studio for both viewers */
  geometry: ProbeGeometry | null;
  /** the edge-letter and corner-number layer */
  showLabels: boolean;
  onToggleLabels: () => void;
  /** the measured distance lines, toggled from the Probe palette */
  showDistances: boolean;
}

/**
 * Where the probe read, drawn in the scene.
 *
 * `depthTest={false}` on purpose: the sample is usually INSIDE the concrete, and a
 * marker the body hides is a marker that does not exist. It reads as a point seen
 * through the element, which is exactly what it is.
 */
function ProbeMarker({ at, radius_m }: { at: [number, number, number]; radius_m: number }) {
  // A marker is a POINT, not an object in the scene. At 2% of the element's bounding
  // radius it was a 130 mm ball on a 6 m slab - big enough to cover the cells around
  // the one it was reporting, which is the one thing it must not do. 0.5% is a dot
  // that still survives being seen through a translucent body, and the floor keeps it
  // visible on a small column.
  const r = Math.max(radius_m * 0.005, 0.004);
  return (
    <mesh position={at} renderOrder={20}>
      <sphereGeometry args={[r, 20, 14]} />
      {/* transparent, so it sorts into the pass the translucent body draws in and
          lands ON TOP of it rather than under. */}
      <meshBasicMaterial color="#7599fa" depthTest={false} depthWrite={false} transparent toneMapped={false} />
    </mesh>
  );
}

/** The plate a name is drawn on. Same look in the scene as on the 2D sheet. */
function SceneTag({
  position,
  children,
  emphasis,
  round,
}: {
  position: [number, number, number];
  children: string;
  emphasis: boolean;
  round?: boolean;
}) {
  return (
    <Html position={position} center zIndexRange={[15, 10]} style={{ pointerEvents: "none" }}>
      <span
        className={cx(
          "flex items-center justify-center border border-accent-blue/40 bg-bg-primary/85",
          "font-mono text-[10px] tabular-nums text-accent-blue backdrop-blur-sm",
          round ? "h-[17px] min-w-[17px] rounded-full px-1" : "rounded-[3px] px-1.5 py-0.5",
          emphasis ? "border-accent-blue/80 font-semibold" : "font-medium",
        )}
      >
        {children}
      </span>
    </Html>
  );
}

/**
 * The label layer, in the scene.
 *
 * The readout names an edge A, B, C and a corner 1, 2, 3; this draws those same names
 * on the element itself. Every one is a real edge of the extrusion — a section vertex
 * swept along the length — so "42 mm to edge B" points at a line the reader can see
 * rather than at an index only the code knows. The 2D sheet draws the identical set,
 * from the same `sectionFeatures`, so a letter means one edge in both viewers.
 */
function SectionAnnotations({
  outline,
  geometry,
  offset_m,
  radius_m,
  zNear,
  zFar,
  probeAt,
  showDistances,
}: {
  outline: [number, number][];
  geometry: ProbeGeometry | null;
  offset_m: [number, number];
  radius_m: number;
  zNear: number;
  zFar: number;
  /** the probe, when there is one — the distance lines start here */
  probeAt: [number, number, number] | null;
  showDistances: boolean;
}) {
  const { edges, corners, cited } = useMemo(() => {
    const all = sectionFeatures(outline);
    const citedEdges = new Set(geometry?.edges.slice(0, 2).map((e) => e.index) ?? []);
    const citedCorners = new Set(geometry?.corners.slice(0, 2).map((c) => c.index) ?? []);
    if (outline.length <= MAX_NAMED_VERTICES) {
      return { edges: all.edges, corners: all.corners, cited: { edges: citedEdges, corners: citedCorners } };
    }
    // a 128-sided circle would be a wall of type; only the cited ones are named
    if (!geometry) return { edges: [], corners: [], cited: { edges: citedEdges, corners: citedCorners } };
    const nearEdges = new Set(geometry.edges.slice(0, 3).map((e) => e.index));
    const nearCorners = new Set(geometry.corners.slice(0, 3).map((c) => c.index));
    return {
      edges: all.edges.filter((e) => nearEdges.has(e.index)),
      corners: all.corners.filter((c) => nearCorners.has(c.index)),
      cited: { edges: citedEdges, corners: citedCorners },
    };
  }, [outline, geometry]);

  const zMid = (zNear + zFar) / 2;
  const off = radius_m * 0.07;
  const to3 = (x: number, y: number, z: number): [number, number, number] => [
    x - offset_m[0],
    y - offset_m[1],
    z,
  ];

  // Every line the layer draws, in one buffer: the swept edges, the swept corner
  // arrises, and the measured distances. One draw call rather than one per feature.
  const lines = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const e of edges) {
      const [x, y] = to3(e.mid[0], e.mid[1], 0);
      pts.push(new THREE.Vector3(x, y, zNear), new THREE.Vector3(x, y, zFar));
    }
    for (const c of corners) {
      const [x, y] = to3(c.at[0], c.at[1], 0);
      pts.push(new THREE.Vector3(x, y, zNear), new THREE.Vector3(x, y, zFar));
    }
    if (showDistances && probeAt && geometry) {
      for (const e of geometry.edges.slice(0, 2)) {
        pts.push(
          new THREE.Vector3(...probeAt),
          new THREE.Vector3(...to3(e.at[0], e.at[1], probeAt[2])),
        );
      }
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  // to3 is a closure over offset_m; listing offset_m is what actually changes it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, corners, geometry, offset_m, zNear, zFar, probeAt, showDistances]);

  useEffect(() => () => lines.dispose(), [lines]);

  return (
    <group>
      <lineSegments geometry={lines} renderOrder={19}>
        <lineBasicMaterial
          color="#7599fa"
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
          transparent
          opacity={0.85}
        />
      </lineSegments>

      {edges.map((e) => (
        <SceneTag
          key={`e${e.index}`}
          position={to3(e.mid[0] + e.normal[0] * off, e.mid[1] + e.normal[1] * off, zMid)}
          emphasis={cited.edges.has(e.index)}
        >
          {e.tag}
        </SceneTag>
      ))}

      {corners.map((c) => (
        <SceneTag
          key={`c${c.index}`}
          position={to3(c.at[0] + c.normal[0] * off, c.at[1] + c.normal[1] * off, zMid)}
          emphasis={cited.corners.has(c.index)}
          round
        >
          {c.tag}
        </SceneTag>
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

export default function Viewer({
  sim,
  frameIndex,
  scale_min_c,
  scale_max_c,
  length_m,
  units,
  pick,
  onPick,
  geometry,
  showLabels,
  onToggleLabels,
  showDistances,
}: ViewerProps) {
  // how much of the length is still shown. 100 = uncut.
  const [cutPct, setCutPct] = useState(100);
  const [opacity, setOpacity] = useState(62);
  const [camView, setCamView] = useState<PresetView | null>("iso");
  const [showTakeoff, setShowTakeoff] = useState(false);

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

  // the spread this frame is actually using, so the legend brackets it the way the
  // 2D sheet's does. Both viewers now say the same thing about the same frame.
  const frameSpread = useMemo(() => {
    const frame = sim.fields?.temp_c[Math.min(frameIndex, sim.fields.temp_c.length - 1)];
    return frame ? frameRange(frame) : null;
  }, [sim.fields, frameIndex]);

  // Where the geometry sits relative to the section origin. The annotation layer needs
  // it to put a label back on a section coordinate, and it is a property of the mesh,
  // not of the probe — so it must not go missing the moment the probe is cleared.
  const meshOffset = useMemo((): [number, number] => {
    const xs = sim.outline_m.map((p) => p[0]);
    const ys = sim.outline_m.map((p) => p[1]);
    return [
      (Math.max(...xs) + Math.min(...xs)) / 2,
      (Math.max(...ys) + Math.min(...ys)) / 2,
    ];
  }, [sim.outline_m]);

  // Read the point the backend sampled its own core temperature at.
  //
  // The 2D sheet has had this since it was built and the 3D view had not, which meant
  // the same question had a control in one viewer and none in the other. It needs no
  // ray: the point is a section coordinate the response carries, so this samples the
  // field directly and puts the marker where the geometry actually sits.
  const probeBackendPoint = useCallback(() => {
    const fields = sim.fields;
    const frame = fields?.temp_c[Math.min(frameIndex, fields.temp_c.length - 1)];
    if (!fields || !frame) return;
    const [x_m, y_m] = sim.probe_xy_m;
    const s = sampleField(frame, fields.dx_m, x_m, y_m);
    if (!s) return;
    onPick({
      sample: s,
      section_m: [x_m, y_m],
      source: "3d",
      view: null,
      isSection: true,
      uv: null,
      // mid-length, which is the only z the backend's 2D point can honestly claim
      world: [s.xy_m[0] - meshOffset[0], s.xy_m[1] - meshOffset[1], 0],
    });
  }, [sim, frameIndex, meshOffset, onPick]);

  // Where the marker goes.
  //
  // A pick taken here carries its own world point, because only the ray knows how far
  // along the length it hit. A pick taken on the 2D sheet does not - the solver is 2D,
  // so its reading is true at every z - and mid-length is the only z it can honestly
  // be drawn at. Not drawing it at all was worse: the palette showed a reading and the
  // scene showed nothing, leaving the reader to wonder which one had gone stale.
  const probeWorld = useMemo((): [number, number, number] | null => {
    if (!pick) return null;
    if (pick.world) return pick.world;
    if (!pick.isSection) return null;
    return [pick.section_m[0] - meshOffset[0], pick.section_m[1] - meshOffset[1], 0];
  }, [pick, meshOffset]);

  // probe click from the mesh — published to the studio, which owns the readout
  const handleProbe = useCallback(
    (result: ProbeResult | null) => {
      if (!result) return;
      onPick({
        sample: result,
        section_m: result.xy_m,
        source: "3d",
        view: null,
        isSection: true,
        uv: null,
        world: result.world,
      });
    },
    [onPick],
  );

  const handleHover = useCallback(
    (temp_c: number, event: { offsetX: number; offsetY: number }) => {
      setHover({ temp_c, x: event.offsetX, y: event.offsetY });
    },
    [],
  );
  const handleHoverEnd = useCallback(() => setHover(null), []);

  const cutOpen = clipFrac < 0.999;
  const takeoffTip = useTooltip(
    <>
      <span className="block font-medium">Cut take-off</span>
      <span className="mt-0.5 block text-text-secondary">
        Face area, perimeter, volume and mass of what the section cut removed — measured
        on the solved mask, not on an idealised polygon.
      </span>
    </>,
    "top",
  );

  return (
    <div className="relative min-h-0 flex-1 bg-bg-primary" ref={canvasWrapRef}>
      {/* Camera presets, then the annotation toggle. Same shape as the 2D sheet's
          strip: the views on the left, the layers that draw over them on the right. */}
      <Toolbar className="absolute left-1/2 top-4 z-20 -translate-x-1/2 flex-wrap justify-center">
        <ToolbarButton
          icon={SquareDashedBottom}
          active={camView === "top"}
          onClick={() => setCamView("top")}
          title="Look straight down on the top face"
        >
          Top
        </ToolbarButton>
        <ToolbarButton
          icon={Scan}
          active={camView === "front"}
          onClick={() => setCamView("front")}
          title="Look along the length, straight at the solved cross-section"
        >
          Front
        </ToolbarButton>
        <ToolbarButton
          icon={View}
          active={camView === "left"}
          onClick={() => setCamView("left")}
          title="Look along the width, at the left face"
        >
          Left
        </ToolbarButton>
        <ToolbarButton
          icon={Box}
          active={camView === "iso"}
          onClick={() => setCamView("iso")}
          title="Isometric — the whole element at once"
        >
          Iso
        </ToolbarButton>
        <ToolbarButton
          icon={RotateCcw}
          onClick={() => setCamView("iso")}
          title="Put the camera back on the isometric preset"
        >
          Reset
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          icon={Tags}
          active={showLabels}
          onClick={onToggleLabels}
          title="Name every edge with a letter and every corner with a number, so the distances in the Probe palette can be traced to lines you can see"
        >
          Labels
        </ToolbarButton>
        <ToolbarButton
          icon={Target}
          onClick={probeBackendPoint}
          title="Read the point the backend sampled its own core temperature at, and send it to the Probe palette"
        >
          Backend point
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
        {probeWorld && <ProbeMarker at={probeWorld} radius_m={radius_m} />}
        {(showLabels || (showDistances && probeWorld)) && (
          <SectionAnnotations
            outline={sim.outline_m}
            geometry={geometry}
            offset_m={meshOffset}
            radius_m={radius_m}
            zNear={-length_m / 2}
            zFar={clipZ ?? length_m / 2}
            probeAt={probeWorld}
            showDistances={showDistances}
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
            {...takeoffTip.trigger}
            type="button"
            onClick={() => setShowTakeoff((v) => !v)}
            aria-expanded={showTakeoff}
            className={cx(
              "flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium tabular-nums",
              showTakeoff ? "bg-accent-blue-dim text-accent-blue" : "text-text-secondary hover:bg-elevate-2 hover:text-text-primary",
            )}
          >
            {cut.removed_volume_m3.toFixed(2)} m³ out
            <ChevronDown className={cx("h-3 w-3 transition-transform duration-150", showTakeoff && "rotate-180")} strokeWidth={2.5} />
          </button>
          {takeoffTip.node}
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

      <div className="pointer-events-none absolute right-4 top-1/2 z-10 -translate-y-1/2">
        <ThermalLegend
          min_c={scale_min_c}
          max_c={scale_max_c}
          defLimit_c={sim.breaches.def_threshold_c}
          frameMin_c={frameSpread?.min_c}
          frameMax_c={frameSpread?.max_c}
        />
      </div>
    </div>
  );
}
