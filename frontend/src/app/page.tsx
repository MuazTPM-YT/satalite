// studio page. Loads a real solve from the backend and hands it to every panel.
"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import TopBar from "@/components/TopBar";
import type { ViewMode } from "@/components/TopBar";
import LeftPanel from "@/components/LeftPanel";
import Viewer from "@/components/Viewer";
import Section2D from "@/components/Section2D";
import ChecksPanel from "@/components/ChecksPanel";
import TimeScrubber from "@/components/TimeScrubber";
import PourWindowTable from "@/components/PourWindowTable";
import EnsemblePanel from "@/components/EnsemblePanel";
import SeasonPanel from "@/components/SeasonPanel";
import ValidationPanel from "@/components/ValidationPanel";
import FloatingPanel from "@/components/FloatingPanel";
import type { PanelGeometry } from "@/components/FloatingPanel";
import type { PanelId } from "@/components/PanelId";
import { ApiError, type PourWindowResult, type SeasonAnalysisResponse, type ValidationResponse } from "@/lib/api";
import { loadDemoRun, loadPourWindows, loadSeason, loadValidation, scaleBounds, type LoadedRun } from "@/lib/scenario";
import { DEFAULT_ELEMENT_CONFIG, type ElementConfig } from "@/lib/elementConfig";
import { importIfcOutline } from "@/lib/ifcImport";
import { IMPORTED_SHAPE, type IfcUiState } from "@/components/LeftPanel";
import type { LengthUnit } from "@/lib/units";

// where each palette opens before first drag/resize
const PANEL_GEO: Record<PanelId, PanelGeometry & { minW: number; minH: number }> = {
  element: { x: 16, y: 16, w: 262, h: 480, minW: 262, minH: 240 },
  checks: { x: 950, y: 16, w: 282, h: 560, minW: 282, minH: 240 },
  pour: { x: 16, y: 320, w: 860, h: 300, minW: 560, minH: 200 },
  ensemble: { x: 60, y: 60, w: 940, h: 700, minW: 620, minH: 360 },
  season: { x: 90, y: 40, w: 900, h: 760, minW: 620, minH: 360 },
  validation: { x: 120, y: 30, w: 860, h: 800, minW: 600, minH: 360 },
};

interface ImportedElement {
  outline: [number, number][];
  length_m: number;
  name: string;
}

export default function StudioPage() {
  // the solved run. null until it lands; error text when it does not.
  const [run, setRun] = useState<LoadedRun | null>(null);
  const [pour, setPour] = useState<PourWindowResult | null>(null);
  const [season, setSeason] = useState<SeasonAnalysisResponse | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [imported, setImported] = useState<ImportedElement | null>(null);
  const [ifcUi, setIfcUi] = useState<IfcUiState>({ busy: false, error: null, name: null });
  const [element, setElement] = useState<ElementConfig>(DEFAULT_ELEMENT_CONFIG);

  const [frameIndex, setFrameIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [openPanels, setOpenPanels] = useState<Record<PanelId, boolean>>({
    element: false,
    checks: true,
    pour: false,
    ensemble: false,
    season: false,
    validation: false,
  });
  const [units, setUnits] = useState<LengthUnit>("m");

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
      .catch((err: unknown) => live && setValidationError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, []);

  // fetch the run once, in the browser. The pour sweep follows off the same scenario;
  // it is allowed to fail on its own without taking the viewer down with it.
  useEffect(() => {
    let live = true;
    loadDemoRun()
      .then((loaded) => {
        if (!live) return;
        setRun(loaded);
        // open on the peak-core frame. t = 0 is the whole section at placement
        // temperature, which is correct and completely uninformative to look at.
        const f = loaded.result.fields;
        if (f) {
          const peak = loaded.result.core_temp_c.indexOf(Math.max(...loaded.result.core_temp_c));
          const idx = f.frame_indices.indexOf(peak);
          if (idx >= 0) setFrameIndex(idx);
        }
        return loadPourWindows(loaded.request)
          .then((p) => live && setPour(p))
          .catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setLoadError(
          err instanceof ApiError ? `${err.status}: ${err.message}` : String(err),
        );
      });
    return () => {
      live = false;
    };
  }, []);

  const bounds = useMemo(() => (run ? scaleBounds(run.result) : null), [run]);
  const frameTimes = useMemo(() => run?.result.fields?.times_h ?? [], [run]);

  const updateElement = useCallback(
    <K extends keyof ElementConfig>(key: K, value: ElementConfig[K]) => {
      if (key === "shape" && value !== IMPORTED_SHAPE) {
        setImported(null);
        setIfcUi({ busy: false, error: null, name: null });
      }
      setElement((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const runImport = useCallback(async (data: ArrayBuffer, fileName: string) => {
    setIfcUi({ busy: true, error: null, name: null });
    setOpenPanels((prev) => ({ ...prev, element: true }));
    const outcome = await importIfcOutline(data);
    if (!outcome.ok) {
      setIfcUi({ busy: false, error: `${fileName}: ${outcome.error}`, name: null });
      return;
    }
    const el = outcome.element;
    setImported({ outline: el.outline, length_m: el.length_m, name: el.name });
    const w = Math.max(...el.outline.map((p) => p[0]));
    const h = Math.max(...el.outline.map((p) => p[1]));
    setElement((prev) => ({
      ...prev,
      shape: IMPORTED_SHAPE,
      flange_width_mm: w * 1000,
      total_depth_mm: h * 1000,
      length_mm: el.length_m * 1000,
    }));
    setIfcUi({ busy: false, error: null, name: el.name });
  }, []);

  const handleImportIfc = useCallback(
    (file: File) => {
      file.arrayBuffer().then((buf) => runImport(buf, file.name));
    },
    [runImport],
  );

  useEffect(() => {
    const url = new URL(window.location.href).searchParams.get("ifc");
    if (!url) return;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => runImport(buf, url))
      .catch((e) => setIfcUi({ busy: false, error: `${url}: ${String(e)}`, name: null }));
  }, [runImport]);

  // snap the slider to the nearest FRAME the response actually carries. The field is
  // strided, so there is no frame between two of these and none is invented.
  const handleTimeChange = useCallback(
    (time_h: number) => {
      if (frameTimes.length === 0) return;
      let best = 0;
      for (let i = 1; i < frameTimes.length; i++) {
        if (Math.abs(frameTimes[i] - time_h) < Math.abs(frameTimes[best] - time_h)) best = i;
      }
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

  // element length. The solver is 2D and returns no length, so this is a VIEW parameter
  // for the extrusion, not a solved quantity.
  const length_m = element.length_mm / 1000;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        openPanels={openPanels}
        onTogglePanel={togglePanel}
        units={units}
        onUnitsChange={setUnits}
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 relative flex min-h-0">
            {loadError ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-lg text-center">
                  <p className="text-sm text-status-red font-medium">Could not load a solve</p>
                  <p className="mt-2 text-xs text-text-secondary leading-relaxed">{loadError}</p>
                  <p className="mt-3 text-[10px] text-text-muted leading-relaxed">
                    Nothing is drawn from a placeholder. The viewer stays empty until the
                    backend returns a run.
                  </p>
                </div>
              </div>
            ) : !run ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-text-secondary">solving…</p>
              </div>
            ) : viewMode === "3d" ? (
              <Viewer
                sim={run.result}
                frameIndex={frameIndex}
                scale_min_c={bounds?.min_c}
                scale_max_c={bounds?.max_c}
                length_m={length_m}
                units={units}
              />
            ) : (
              <Section2D
                sim={run.result}
                frameIndex={frameIndex}
                length_m={length_m}
                units={units}
              />
            )}

            <div className="absolute inset-0 pointer-events-none">
              {openPanels.element && (
                <FloatingPanel
                  title="Element & Mix Inputs"
                  defaultGeo={PANEL_GEO.element}
                  minWidth={PANEL_GEO.element.minW}
                  minHeight={PANEL_GEO.element.minH}
                  onClose={() => closePanel("element")}
                >
                  <LeftPanel
                    config={element}
                    onChange={updateElement}
                    units={units}
                    ifc={ifcUi}
                    onImportIfc={handleImportIfc}
                    importedOutline={imported?.outline ?? null}
                  />
                </FloatingPanel>
              )}
              {openPanels.checks && run && (
                <FloatingPanel
                  title="Checks"
                  defaultGeo={PANEL_GEO.checks}
                  minWidth={PANEL_GEO.checks.minW}
                  minHeight={PANEL_GEO.checks.minH}
                  onClose={() => closePanel("checks")}
                >
                  <ChecksPanel sim={run.result} request={run.request} />
                </FloatingPanel>
              )}
              {openPanels.ensemble && run && (
                <FloatingPanel
                  title="Ensemble band — precomputed, one fixed scenario"
                  defaultGeo={PANEL_GEO.ensemble}
                  minWidth={PANEL_GEO.ensemble.minW}
                  minHeight={PANEL_GEO.ensemble.minH}
                  onClose={() => closePanel("ensemble")}
                >
                  <EnsemblePanel demo={run.demo} nominal={run.result} />
                </FloatingPanel>
              )}
              {openPanels.season && (
                <FloatingPanel
                  title="Season replay — precomputed"
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
              )}
              {openPanels.validation && (
                <FloatingPanel
                  title="Validation — USBR DSO-12-02 cases"
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
                      <p className="mt-1 text-[11px] text-text-secondary leading-relaxed">
                        {validationError}
                      </p>
                    </div>
                  ) : (
                    <p className="p-3 text-xs text-text-secondary">loading validation report…</p>
                  )}
                </FloatingPanel>
              )}
              {openPanels.pour && (
                <FloatingPanel
                  title="Pour Window"
                  defaultGeo={PANEL_GEO.pour}
                  minWidth={PANEL_GEO.pour.minW}
                  minHeight={PANEL_GEO.pour.minH}
                  onClose={() => closePanel("pour")}
                >
                  {pour ? (
                    <PourWindowTable
                      candidates={pour.candidates}
                      best_offset_h={pour.best_offset_h}
                    />
                  ) : (
                    <p className="p-3 text-xs text-text-secondary">
                      sweeping candidate start hours…
                    </p>
                  )}
                </FloatingPanel>
              )}
            </div>
          </div>
          <TimeScrubber
            times_h={frameTimes}
            frameIndex={frameIndex}
            onTimeChange={handleTimeChange}
          />
        </div>
      </div>
    </div>
  );
}
