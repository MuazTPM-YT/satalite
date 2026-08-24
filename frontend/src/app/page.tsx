// Studio page. Owns the inputs, turns them into a request, and hands the solved run
// to every panel.
//
// The inputs DRIVE the solve. Changing a dimension, a mix number or the cure window
// re-runs /api/simulate and everything on screen follows - so the one thing this file
// has to get right is that nothing is ever drawn from a request that has not been
// solved. `stale` says when the boxes and the drawing have parted company, and the
// drawing keeps showing the last real answer until a new one lands.
"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import TopBar from "@/components/TopBar";
import type { ViewMode } from "@/components/TopBar";
import LeftPanel from "@/components/LeftPanel";
import type { IfcUiState } from "@/components/LeftPanel";
import dynamic from "next/dynamic";
import Section2D from "@/components/Section2D";
import ChecksPanel from "@/components/ChecksPanel";
import ProbeCard from "@/components/ProbeCard";
import TimeScrubber from "@/components/TimeScrubber";
import HistoryChart from "@/components/HistoryChart";
import PourWindowTable from "@/components/PourWindowTable";
import EnsemblePanel from "@/components/EnsemblePanel";
import SeasonPanel from "@/components/SeasonPanel";
import ValidationPanel from "@/components/ValidationPanel";
import FloatingPanel from "@/components/FloatingPanel";
import type { ContainerSize, PanelGeometry } from "@/components/FloatingPanel";
import type { PanelId } from "@/components/PanelId";
import {
  ApiError,
  simulate,
  type AmbientSpec,
  type DemoEnsembleResponse,
  type PourWindowResult,
  type SeasonAnalysisResponse,
  type SimulationRequest,
  type SimulationResult,
  type ValidationResponse,
} from "@/lib/api";
import {
  FIELD_STRIDE_H,
  loadPourWindows,
  loadSeason,
  loadValidation,
  requestKey as stableKey,
  scaleBounds,
  demoScenario,
} from "@/lib/scenario";
import {
  DEFAULT_ELEMENT_CONFIG,
  configFromRequest,
  defaultDims,
  lengthM,
  toSimulationRequest,
  type ElementConfig,
} from "@/lib/elementConfig";
import { probeGeometry } from "@/lib/sectionMetrics";
import type { ProbePick } from "@/lib/probe";
import { clampDims, type Outline, type ShapeId } from "@/lib/shapes";
import type { LengthUnit } from "@/lib/units";

// three.js, @react-three/fiber and drei are about a megabyte of the bundle, and the
// studio opens in 2D. Loading them on demand means the sheet is interactive without
// ever paying for a WebGL renderer the reader may not open. `ssr: false` because there
// is no canvas to render on the server, and the fallback is the same spinner the first
// solve uses so switching views does not introduce a second loading vocabulary.
const Viewer = dynamic(() => import("@/components/Viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-accent-blue" />
      <p className="text-xs text-text-secondary">Loading the 3D viewer…</p>
    </div>
  ),
});

// Spawn x for a palette that should open against the RIGHT edge. clampGeo pulls any
// overshoot back to `width - w - margin`, so asking for "further right than possible"
// is how a palette says "dock me right" without knowing the viewport.
const DOCK_RIGHT = 100_000;
// and the same trick downward, for a palette that belongs at the foot of the viewer
const DOCK_BOTTOM = 100_000;

// where each palette opens before first drag/resize
const PANEL_GEO: Record<PanelId, PanelGeometry & { minW: number; minH: number }> = {
  element: { x: 16, y: 16, w: 340, h: 600, minW: 300, minH: 260 },
  // Bottom-left, which is the one corner nothing else claims. Docking it to the right
  // put it exactly on top of Checks, which opens there by default.
  probe: { x: 16, y: DOCK_BOTTOM, w: 300, h: 336, minW: 260, minH: 150 },
  checks: { x: DOCK_RIGHT, y: 16, w: 316, h: 600, minW: 268, minH: 240 },
  pour: { x: 380, y: 340, w: 860, h: 300, minW: 420, minH: 200 },
  ensemble: { x: 60, y: 60, w: 940, h: 700, minW: 620, minH: 360 },
  season: { x: 90, y: 40, w: 900, h: 760, minW: 620, minH: 360 },
  validation: { x: 120, y: 30, w: 860, h: 800, minW: 600, minH: 360 },
};

// how long after a slider is released before the solve fires. Long enough to coalesce
// a flurry of commits, short enough that it still reads as a response to the drag.
const SOLVE_DEBOUNCE_MS = 350;

interface Run {
  request: SimulationRequest;
  result: SimulationResult;
  /** the request this run answers, serialised. Compared against the live one for staleness. */
  key: string;
}

export default function StudioPage() {
  // The scenario artifact. Its ambient series is real cached data that was actually
  // solved, so reusing it costs no FortyGuard quota and is reproducible between runs.
  const [demo, setDemo] = useState<DemoEnsembleResponse | null>(null);
  const [ambient, setAmbient] = useState<AmbientSpec | null>(null);

  const [run, setRun] = useState<Run | null>(null);
  const [solving, setSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);

  // The sweep carries the key of the run it answers, so a result can be shown only
  // beside the run it belongs to - and the effect below never has to clear it
  // synchronously to keep that true.
  const [pour, setPour] = useState<{ key: string; data: PourWindowResult | null; error: string | null } | null>(null);
  const pourFetchedKey = useRef<string | null>(null);
  const [season, setSeason] = useState<SeasonAnalysisResponse | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [importedOutline, setImportedOutline] = useState<Outline | null>(null);
  const [ifcUi, setIfcUi] = useState<IfcUiState>({ busy: false, error: null, name: null });
  // The inputs, and the scenario they opened on.
  //
  // Both come from the artifact rather than from constants typed here: `scenarioConfig`
  // is what every Reset control returns to, so "reset" means "back to the scenario the
  // backend actually solved" and not "back to a number somebody once copied".
  const [config, setConfig] = useState<ElementConfig>(DEFAULT_ELEMENT_CONFIG);
  const [scenarioConfig, setScenarioConfig] = useState<ElementConfig>(DEFAULT_ELEMENT_CONFIG);

  const [frameIndex, setFrameIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  // Palettes float OVER the drawing, so every one that opens by default is drawing
  // the user cannot see. Checks earns its place - it is the answer. The inputs open
  // from the command bar, which also carries the Solve button, so nothing about them
  // is hidden by starting closed.
  const [openPanels, setOpenPanels] = useState<Record<PanelId, boolean>>({
    element: false,
    probe: false,
    checks: true,
    pour: false,
    ensemble: false,
    season: false,
    validation: false,
  });
  const [units, setUnits] = useState<LengthUnit>("m");

  // The probe lives HERE, not in a viewer.
  //
  // It used to be a popup anchored at the click inside each viewer - two copies of the
  // same state, each covering the drawing it was describing, and neither reachable
  // once it was dismissed. As one palette launched from the command bar it is parked
  // where the reader wants it, survives switching between 2D and 3D, and there is one
  // answer on screen rather than two that can disagree.
  const [pick, setPick] = useState<ProbePick | null>(null);
  const [showDistances, setShowDistances] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  // The surface palettes are bounded to, and its measured size. The page owns the
  // measurement so every palette re-clamps off the same numbers at the same moment.
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overlaySize, setOverlaySize] = useState<ContainerSize | null>(null);

  /* ── the request ──────────────────────────────────────────────────────────── */

  const request = useMemo(
    () => (ambient ? toSimulationRequest(config, ambient) : null),
    [config, ambient],
  );
  // Order-independent, so a request rebuilt from the inputs matches the identical one
  // the backend sent back rather than differing by pydantic's field order.
  const requestKey = useMemo(() => (request ? stableKey(request) : null), [request]);
  const stale = requestKey !== null && run !== null && requestKey !== run.key;

  // Drop a response whose request has already been superseded. Without this, releasing
  // two sliders in quick succession can land the slower answer last.
  const solveSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Time is preserved across solves rather than reset: re-solving is a comparison, and
  // being thrown back to t=0 (or to a different peak) hides what actually changed.
  const holdTime_h = useRef<number | null>(null);

  // Solve whatever the inputs currently describe.
  //
  // Re-created on every input change, which is exactly right: the debounce timer and
  // the Solve button both capture the callback at the moment they fire, so they always
  // send the request that was on screen then - not the one that existed when some
  // earlier render defined the callback.
  const runSolve = useCallback(async () => {
    if (!request || !requestKey) return;
    const seq = ++solveSeq.current;
    setSolving(true);
    setSolveError(null);
    try {
      const result = await simulate(request, { fields: true, fields_stride_h: FIELD_STRIDE_H });
      if (seq !== solveSeq.current) return;
      setRun({ request, result, key: requestKey });
      setSolveError(null);
    } catch (err: unknown) {
      if (seq !== solveSeq.current) return;
      setSolveError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
    } finally {
      if (seq === solveSeq.current) setSolving(false);
    }
  }, [request, requestKey]);

  // The debounce has to fire the LATEST runSolve, not the one that existed when the
  // edit was committed.
  //
  // Handing `runSolve` straight to setTimeout looked equivalent and was not: an edit
  // calls onChange and onCommit in the same handler, so the timer was armed with the
  // callback from the render BEFORE the state change - and 350 ms later it solved the
  // config the user had just moved away from. A shape change re-solved the old shape
  // and then reported itself stale, which is exactly what it was.
  const runSolveRef = useRef(runSolve);
  useEffect(() => {
    runSolveRef.current = runSolve;
  }, [runSolve]);

  // A committed edit — a slider released, a field left, a dropdown chosen.
  const commit = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSolveRef.current(), SOLVE_DEBOUNCE_MS);
  }, []);

  const solveNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void runSolveRef.current();
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  /* ── loads ────────────────────────────────────────────────────────────────── */

  // the scenario, then the first solve off it.
  useEffect(() => {
    let live = true;
    demoScenario()
      .then((d) => {
        if (!live) return;
        setDemo(d);
        setAmbient(d.scenario.ambient);
        // Open on the scenario the artifact was solved for. Every input follows from
        // the response, so a regenerated artifact moves the studio with it.
        const seeded = configFromRequest(d.scenario);
        setScenarioConfig(seeded);
        setConfig(seeded);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setSolveError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  // first solve, once there is weather to solve against. Guarded on `run` so this
  // fires exactly once — every later solve comes from a commit or the Solve button.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!ambient || bootstrapped.current) return;
    bootstrapped.current = true;
    void runSolve();
  }, [ambient, runSolve]);

  // the season artifact is independent of the run and may legitimately be absent.
  useEffect(() => {
    let live = true;
    loadSeason()
      .then((s) => live && setSeason(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // the validation report is independent of the run. It 503s when it has not been
  // generated, which is a real state worth showing rather than an empty panel.
  useEffect(() => {
    let live = true;
    loadValidation()
      .then((v) => live && setValidation(v))
      .catch((err: unknown) =>
        live && setValidationError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      live = false;
    };
  }, []);

  // The pour sweep is six solves. It runs only while its palette is open, and only
  // once per request — opening it used to be free because it ran on load regardless.
  useEffect(() => {
    if (!openPanels.pour || !run || pourFetchedKey.current === run.key) return;
    const key = run.key;
    pourFetchedKey.current = key;
    let live = true;
    loadPourWindows(run.request)
      .then((p) => live && setPour({ key, data: p, error: null }))
      .catch((err: unknown) => {
        if (!live) return;
        setPour({
          key,
          data: null,
          error: err instanceof ApiError ? `${err.status}: ${err.message}` : String(err),
        });
      });
    return () => {
      live = false;
    };
  }, [openPanels.pour, run]);

  // Re-measure on the two things that change the overlay's box: the window resizing,
  // and the layout around it changing.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      if (next.w === 0 || next.h === 0) return;
      setOverlaySize((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [run, viewMode, solveError]);

  /* ── derived ──────────────────────────────────────────────────────────────── */

  const bounds = useMemo(() => (run ? scaleBounds(run.result) : null), [run]);
  const frameTimes = useMemo(() => run?.result.fields?.times_h ?? [], [run]);
  const ambientSpan_h = ambient ? ambient.hours_h[ambient.hours_h.length - 1] - ambient.hours_h[0] : 72;

  // Land on the frame nearest the time that was on screen before, or on the peak-core
  // frame the first time — t=0 is the whole section at placement temperature, which is
  // correct and completely uninformative to look at.
  useEffect(() => {
    const f = run?.result.fields;
    if (!f || f.times_h.length === 0) return;
    const want = holdTime_h.current;
    if (want === null) {
      const peak = run.result.core_temp_c.indexOf(Math.max(...run.result.core_temp_c));
      const idx = f.frame_indices.indexOf(peak);
      setFrameIndex(idx >= 0 ? idx : 0);
      return;
    }
    let best = 0;
    for (let i = 1; i < f.times_h.length; i++) {
      if (Math.abs(f.times_h[i] - want) < Math.abs(f.times_h[best] - want)) best = i;
    }
    setFrameIndex(best);
  }, [run]);

  /* ── input handlers ───────────────────────────────────────────────────────── */

  const updateConfig = useCallback(
    <K extends keyof ElementConfig>(key: K, value: ElementConfig[K]) => {
      setConfig((prev) => {
        if (key !== "shape") return { ...prev, [key]: value };
        // A new shape brings a new set of dimension keys. Carrying the old dims over
        // would leave the request holding keys this shape's outline() never reads and
        // missing the ones it does.
        const shape = value as ShapeId;
        return { ...prev, shape, dims_mm: defaultDims(shape) };
      });
    },
    [],
  );

  const updateDim = useCallback((key: string, value_mm: number) => {
    setConfig((prev) => ({
      ...prev,
      dims_mm: clampDims(prev.shape, { ...prev.dims_mm, [key]: value_mm }),
    }));
  }, []);

  // The IFC reader is loaded when a file is chosen, not before. web-ifc is the
  // largest dependency in the project by a wide margin and most sessions never open
  // an IFC at all, so it has no business in the bundle that draws the first frame.
  const handleImportIfc = useCallback((file: File) => {
    setIfcUi({ busy: true, error: null, name: null });
    setOpenPanels((prev) => ({ ...prev, element: true }));
    file
      .arrayBuffer()
      .then(async (buf) => (await import("@/lib/ifcImport")).importIfcOutline(buf))
      .then((outcome) => {
        if (!outcome.ok) {
          setIfcUi({ busy: false, error: `${file.name}: ${outcome.error}`, name: null });
          return;
        }
        setImportedOutline(outcome.element.outline);
        setConfig((prev) => ({ ...prev, length_mm: outcome.element.length_m * 1000 }));
        setIfcUi({ busy: false, error: null, name: outcome.element.name });
      })
      .catch((e: unknown) =>
        setIfcUi({ busy: false, error: `${file.name}: ${String(e)}`, name: null }),
      );
  }, []);

  // snap the slider to the nearest FRAME the response actually carries. The field is
  // strided, so there is no frame between two of these and none is invented.
  const handleTimeChange = useCallback(
    (time_h: number) => {
      if (frameTimes.length === 0) return;
      let best = 0;
      for (let i = 1; i < frameTimes.length; i++) {
        if (Math.abs(frameTimes[i] - time_h) < Math.abs(frameTimes[best] - time_h)) best = i;
      }
      holdTime_h.current = frameTimes[best];
      setFrameIndex(best);
    },
    [frameTimes],
  );

  const togglePanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const closePanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => ({ ...prev, [id]: false }));
  }, []);

  // The precomputed band describes ONE fixed scenario. Once the inputs move off it,
  // the band is no longer a band for the run on screen and has to say so.
  const demoKey = useMemo(() => (demo ? stableKey(demo.scenario) : null), [demo]);
  const matchesDemo = demoKey !== null && run !== null && demoKey === stableKey(run.request);

  // a sweep is only shown beside the run it was computed for.
  const pourReady = pour && run && pour.key === run.key ? pour : null;

  const length_m = lengthM(config);

  // Distances are measured against the SOLVED outline, once, for both viewers - so
  // the 2D sheet, the 3D scene and the readout cannot cite three different geometries.
  const pickGeometry = useMemo(
    () => (run && pick && pick.isSection ? probeGeometry(run.result.outline_m, pick.section_m) : null),
    [run, pick],
  );

  // A reading belongs to the run it was taken from. A new solve moves the field out
  // from under it, so the number in the palette would be a temperature from the
  // previous answer. Adjusting during render rather than in an effect is React's
  // documented pattern for reacting to changed state, and it avoids painting the
  // stale reading once before clearing it.
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  if (run && run.key !== pickedFrom) {
    setPickedFrom(run.key);
    if (pick) setPick(null);
  }

  // reading the probe is the moment the palette is worth opening
  const handlePick = useCallback((next: ProbePick | null) => {
    setPick(next);
    if (next) setOpenPanels((prev) => (prev.probe ? prev : { ...prev, probe: true }));
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        openPanels={openPanels}
        onTogglePanel={togglePanel}
        units={units}
        onUnitsChange={setUnits}
        solving={solving}
        stale={stale}
        onSolve={solveNow}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            {!run && solveError ? (
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="max-w-lg rounded-xl border border-status-red/30 bg-status-red-dim p-5 text-center">
                  <p className="text-sm font-medium text-status-red">Could not load a solve</p>
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {solveError}
                  </p>
                  <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
                    Nothing is drawn from a placeholder. The viewer stays empty until the
                    backend returns a run.
                  </p>
                </div>
              </div>
            ) : !run ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-accent-blue" />
                <p className="text-xs text-text-secondary">Solving…</p>
              </div>
            ) : viewMode === "3d" ? (
              <Viewer
                sim={run.result}
                frameIndex={frameIndex}
                scale_min_c={bounds?.min_c}
                scale_max_c={bounds?.max_c}
                length_m={length_m}
                units={units}
                pick={pick}
                onPick={handlePick}
                geometry={pickGeometry}
                showLabels={showLabels}
                onToggleLabels={() => setShowLabels((v) => !v)}
                showDistances={showDistances}
              />
            ) : (
              <Section2D
                sim={run.result}
                frameIndex={frameIndex}
                length_m={length_m}
                units={units}
                scale_min_c={bounds?.min_c}
                scale_max_c={bounds?.max_c}
                pick={pick}
                onPick={handlePick}
                geometry={pickGeometry}
                showLabels={showLabels}
                onToggleLabels={() => setShowLabels((v) => !v)}
                showDistances={showDistances}
              />
            )}

            {/* A solve that fails AFTER one has succeeded must not blank the viewer:
                the run on screen is still a real answer to a real request. */}
            {run && solveError && (
              <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-4">
                <p className="pointer-events-auto max-w-lg rounded-lg border border-status-red/40 bg-status-red-dim px-3 py-2 font-mono text-[10px] leading-relaxed text-status-red backdrop-blur-xl">
                  The last solve was rejected: {solveError}. The drawing is still the
                  previous answer.
                </p>
              </div>
            )}

            {/* Palettes stay MOUNTED for the whole session and are hidden by CSS when
                closed, so opening and closing can animate. The overlay stops short of
                the right edge on purpose: palettes are bounded to it, so that gutter is
                a strip the thermal legend keeps to itself. */}
            <div
              ref={overlayRef}
              className="pointer-events-none absolute inset-y-0 left-0 right-[104px]"
            >
              <FloatingPanel
                title="Element & Mix Inputs"
                open={openPanels.element}
                containerSize={overlaySize}
                defaultGeo={PANEL_GEO.element}
                minWidth={PANEL_GEO.element.minW}
                minHeight={PANEL_GEO.element.minH}
                onClose={() => closePanel("element")}
              >
                <LeftPanel
                  config={config}
                  defaults={scenarioConfig}
                  onChange={updateConfig}
                  onDimChange={updateDim}
                  onCommit={commit}
                  units={units}
                  ifc={ifcUi}
                  onImportIfc={handleImportIfc}
                  importedOutline={importedOutline}
                  ambientSpan_h={ambientSpan_h}
                  solving={solving}
                  stale={stale}
                  onSolve={solveNow}
                />
              </FloatingPanel>

              {run && (
                <FloatingPanel
                  title="Probe"
                  open={openPanels.probe}
                  containerSize={overlaySize}
                  defaultGeo={PANEL_GEO.probe}
                  minWidth={PANEL_GEO.probe.minW}
                  minHeight={PANEL_GEO.probe.minH}
                  onClose={() => closePanel("probe")}
                >
                  <ProbeCard
                    pick={pick}
                    geometry={pickGeometry}
                    units={units}
                    showDistances={showDistances}
                    onToggleDistances={() => setShowDistances((v) => !v)}
                    showLabels={showLabels}
                    onToggleLabels={() => setShowLabels((v) => !v)}
                    footer={
                      <>
                        backend probe_xy_m [{run.result.probe_xy_m[0].toFixed(3)},{" "}
                        {run.result.probe_xy_m[1].toFixed(3)}] m
                        <br />
                        peak_core_temp_c {run.result.peak_core_temp_c.toFixed(2)} °C at{" "}
                        {run.result.peak_core_time_h.toFixed(1)} h
                      </>
                    }
                  />
                </FloatingPanel>
              )}

              {run && (
                <FloatingPanel
                  title="Checks"
                  open={openPanels.checks}
                  containerSize={overlaySize}
                  defaultGeo={PANEL_GEO.checks}
                  minWidth={PANEL_GEO.checks.minW}
                  minHeight={PANEL_GEO.checks.minH}
                  onClose={() => closePanel("checks")}
                >
                  <ChecksPanel sim={run.result} request={run.request} />
                </FloatingPanel>
              )}

              {run && demo && (
                <FloatingPanel
                  title="Ensemble band — precomputed, one fixed scenario"
                  open={openPanels.ensemble}
                  containerSize={overlaySize}
                  defaultGeo={PANEL_GEO.ensemble}
                  minWidth={PANEL_GEO.ensemble.minW}
                  minHeight={PANEL_GEO.ensemble.minH}
                  onClose={() => closePanel("ensemble")}
                >
                  <EnsemblePanel demo={demo} nominal={run.result} matchesDemo={matchesDemo} />
                </FloatingPanel>
              )}

              <FloatingPanel
                title="Season replay — precomputed"
                open={openPanels.season}
                containerSize={overlaySize}
                defaultGeo={PANEL_GEO.season}
                minWidth={PANEL_GEO.season.minW}
                minHeight={PANEL_GEO.season.minH}
                onClose={() => closePanel("season")}
              >
                {season ? (
                  <SeasonPanel season={season} />
                ) : (
                  <p className="p-3 text-xs text-text-secondary">loading season replay…</p>
                )}
              </FloatingPanel>

              <FloatingPanel
                title="Validation — USBR DSO-12-02 cases"
                open={openPanels.validation}
                containerSize={overlaySize}
                defaultGeo={PANEL_GEO.validation}
                minWidth={PANEL_GEO.validation.minW}
                minHeight={PANEL_GEO.validation.minH}
                onClose={() => closePanel("validation")}
              >
                {validation ? (
                  <ValidationPanel validation={validation} />
                ) : validationError ? (
                  <div className="p-3">
                    <p className="text-xs text-status-red">
                      The validation report is not available.
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                      {validationError}
                    </p>
                  </div>
                ) : (
                  <p className="p-3 text-xs text-text-secondary">loading validation report…</p>
                )}
              </FloatingPanel>

              <FloatingPanel
                title="Pour Window"
                open={openPanels.pour}
                containerSize={overlaySize}
                defaultGeo={PANEL_GEO.pour}
                minWidth={PANEL_GEO.pour.minW}
                minHeight={PANEL_GEO.pour.minH}
                onClose={() => closePanel("pour")}
              >
                {pourReady?.data ? (
                  <PourWindowTable
                    candidates={pourReady.data.candidates}
                    best_offset_h={pourReady.data.best_offset_h}
                  />
                ) : pourReady?.error ? (
                  <div className="p-3">
                    <p className="text-[11px] text-status-red">The pour sweep did not return.</p>
                    <p className="mt-1 font-mono text-[10px] leading-relaxed text-text-secondary">
                      {pourReady.error}
                    </p>
                  </div>
                ) : (
                  <p className="p-3 text-[11px] text-text-secondary">
                    Sweeping candidate start hours for these inputs — six solves.
                  </p>
                )}
              </FloatingPanel>
            </div>
          </div>

          {/* The scopes dock belongs to the run, not to one viewer: mounting it in 2D
              only meant the 3D view silently had no thermal history at all. */}
          {run && <HistoryChart sim={run.result} frameIndex={frameIndex} />}

          <TimeScrubber times_h={frameTimes} frameIndex={frameIndex} onTimeChange={handleTimeChange} />

          {/* Status bar. Where the solve came from and what it is keyed to, always on
              screen, the way a drafting application keeps its coordinate readout. */}
          <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border-default bg-bg-surface px-4 font-mono text-[10px] tabular-nums text-text-muted">
            {run ? (
              <>
                <span>{run.request.element.shape}</span>
                <span className="h-3 w-px bg-hairline" />
                <span>
                  probe [{run.result.probe_xy_m[0].toFixed(3)},{" "}
                  {run.result.probe_xy_m[1].toFixed(3)}] m
                </span>
                <span className="h-3 w-px bg-hairline" />
                <span>
                  peak_core {run.result.peak_core_temp_c.toFixed(2)} °C @{" "}
                  {run.result.peak_core_time_h.toFixed(1)} h
                </span>
                <span className="h-3 w-px bg-hairline" />
                <span>
                  {frameTimes.length} frames · {units}
                </span>
                {solving && <span className="text-accent-blue">solving…</span>}
                {!solving && stale && <span className="text-status-amber">inputs changed</span>}
              </>
            ) : (
              <span>no run loaded</span>
            )}
            <span className="ml-auto uppercase tracking-[0.08em]">
              {viewMode === "3d" ? "3D · perspective" : "2D · orthographic"}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
